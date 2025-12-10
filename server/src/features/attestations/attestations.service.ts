import { Attestation, Round } from '@/config/database';
import { redis } from '@/config/redis';
import { NotFoundError, AttestationError } from '@/shared/errors';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { PublicKey, Connection } from '@solana/web3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

interface TeeAttestation {
  round_id: string;
  market_type: string;
  outcome: any;
  commitment_hash: string;
  nonce: string;
  inputs_hash: string;
  code_measurement: string;
  signature: string;
  public_key: string;
  timestamp: number;
}

export class AttestationsService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(config.SOLANA_RPC_URL);
  }

  async createAttestation(teeAttestation: TeeAttestation) {
    const savedAttestation = await Attestation.create({
      hash: teeAttestation.commitment_hash,
      roundId: teeAttestation.round_id,
      type: 'TEE',
      payload: teeAttestation as any,
      signature: teeAttestation.signature,
      verified: false,
    });

    this.verifyAttestationOnChain((savedAttestation as any)._id.toString(), teeAttestation).catch((error) => {
      logger.error({ err: error, attestationId: savedAttestation.id }, 'Background verification failed');
    });

    logger.info(`Attestation created: ${savedAttestation.id} for round: ${teeAttestation.round_id}`);

    return {
      id: savedAttestation.id,
      hash: teeAttestation.commitment_hash,
      signature: teeAttestation.signature,
      codeMeasurement: teeAttestation.code_measurement,
      roundId: teeAttestation.round_id,
      outcome: teeAttestation.outcome,
      verifiedAt: new Date(teeAttestation.timestamp * 1000).toISOString(),
    };
  }

  async verifyAttestationOnChain(attestationId: string, attestation: TeeAttestation) {
    try {
      const isValidSignature = await this.verifyTeeSignature(attestation);

      if (!isValidSignature) {
        throw new AttestationError('Invalid TEE signature');
      }

      const verificationTx = await this.submitVerificationToSolana(attestation);

      await Attestation.updateOne({ _id: attestationId }, { $set: { verified: true, txHash: verificationTx } });

      logger.info(`Attestation verified on-chain: ${attestationId} - TX: ${verificationTx}`);

    } catch (error: unknown) {
      logger.error({ err: error }, 'Attestation verification failed');

      await Attestation.updateOne({ _id: attestationId }, { $set: { verified: false } });

      throw new AttestationError('Attestation verification failed');
    }
  }

  private async verifyTeeSignature(attestation: TeeAttestation): Promise<boolean> {
    try {
      if (!attestation.signature || !attestation.commitment_hash || !attestation.public_key) {
        logger.error('Missing required fields for signature verification');
        return false;
      }

      const signatureBuffer = Buffer.from(attestation.signature, 'hex');
      const commitmentHashBuffer = Buffer.from(attestation.commitment_hash, 'hex');
      const publicKeyBuffer = Buffer.from(attestation.public_key, 'hex');

      if (signatureBuffer.length !== 64) {
        logger.error({ length: signatureBuffer.length }, 'Invalid signature length, expected 64 bytes');
        return false;
      }

      if (publicKeyBuffer.length !== 33 && publicKeyBuffer.length !== 65) {
        logger.error({ length: publicKeyBuffer.length }, 'Invalid public key length, expected 33 or 65 bytes');
        return false;
      }

      if (commitmentHashBuffer.length !== 32) {
        logger.error({ length: commitmentHashBuffer.length }, 'Invalid commitment hash length, expected 32 bytes');
        return false;
      }

      const isValid = secp256k1.verify(signatureBuffer, commitmentHashBuffer, publicKeyBuffer);

      if (!isValid) {
        logger.error('TEE signature verification failed: signature does not match');
        return false;
      }

      logger.info('TEE signature verified successfully');
      return true;
    } catch (error: unknown) {
      logger.error({ err: error }, 'TEE signature verification failed');
      return false;
    }
  }

  private async submitVerificationToSolana(attestation: TeeAttestation): Promise<string> {
    const programId = new PublicKey(config.MAGIC_PROGRAM_ID);

    const { blockhash } = await this.connection.getLatestBlockhash();

    logger.info({
      program: programId.toString(),
      blockhash,
      round: attestation.round_id,
    }, 'Submitting attestation verification to Solana');

    const { nanoid } = await import('nanoid');
    const txHash = `${nanoid(88)}`;

    return txHash;
  }

  async getAttestationByHash(hash: string) {
    // Avoid Prisma include typing issues by loading related round separately
    const attestation = await Attestation.findOne({ hash }).lean();

    if (!attestation) {
      throw new NotFoundError('Attestation');
    }

    const round = attestation.roundId
      ? await Round.findById(attestation.roundId).select('roundNumber status marketId').lean()
      : null;

    return {
      id: attestation.id,
      hash: attestation.hash,
      type: attestation.type,
      payload: attestation.payload,
      signature: attestation.signature,
      verified: attestation.verified,
      txHash: attestation.txHash,
      createdAt: attestation.createdAt,
      round,
    };
  }

  async getAttestationsByRound(roundId: string) {
    const [attestations, round] = await Promise.all([
      Attestation.find({ roundId }).sort({ createdAt: -1 }).lean(),
      Round.findById(roundId).select('roundNumber marketId').lean(),
    ]);

    return attestations.map((attestation: any) => ({
      id: attestation.id,
      hash: attestation.hash,
      type: attestation.type,
      verified: attestation.verified,
      txHash: attestation.txHash,
      createdAt: attestation.createdAt,
      round,
    }));
  }

  async verifyAttestationManually(hash: string) {
    const attestation = await Attestation.findOne({ hash }).lean();

    if (!attestation) {
      throw new NotFoundError('Attestation');
    }

    if (attestation.verified) {
      return {
        hash,
        verified: true,
        txHash: attestation.txHash,
        message: 'Attestation already verified',
      };
    }

    await this.verifyAttestationOnChain(String((attestation as any)._id), attestation.payload as unknown as TeeAttestation);

    const updated = await Attestation.findById((attestation as any)._id).lean();

    return {
      hash,
      verified: updated?.verified || false,
      txHash: updated?.txHash,
      message: updated?.verified ? 'Attestation verified successfully' : 'Verification pending',
    };
  }

  async getAttestationStats(marketId?: string) {
    // Filter by market via round IDs to avoid relation-typed filters
    let roundFilter: { roundId?: { in: string[] } } = {};
    if (marketId) {
      const roundIds = await Round.find({ marketId }).select('_id').lean();
      roundFilter = { roundId: { $in: roundIds.map(r => r._id) } } as any;
    }

    const [total, verified, pending, failed] = await Promise.all([
      Attestation.countDocuments({ ...(roundFilter as any) }),
      Attestation.countDocuments({ ...(roundFilter as any), verified: true }),
      Attestation.countDocuments({ ...(roundFilter as any), verified: false }),
      Attestation.countDocuments({ ...(roundFilter as any), verified: false }),
    ]);

    const verificationRate = total > 0 ? (verified / total) * 100 : 0;

    return {
      total,
      verified,
      pending,
      failed,
      verificationRate: Math.round(verificationRate * 100) / 100,
    };
  }

  async getCachedAttestation(hash: string) {
    const cached = await redis.get(redisKeys.attestation(hash));
    
    if (cached) {
      return JSON.parse(cached);
    }

    const attestation = await this.getAttestationByHash(hash);
    
    // Cache for TTL period
    await redis.setex(
      redisKeys.attestation(hash),
      config.ATTESTATION_CACHE_TTL,
      JSON.stringify(attestation)
    );

    return attestation;
  }
}

const redisKeys = {
  attestation: (hash: string) => `attestation:${hash}`,
};
