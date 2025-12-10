import { FastifyRequest, FastifyReply } from 'fastify';
import { AttestationsService } from './attestations.service';
import { success} from '@/utils/response';
import { asyncHandler } from '@/utils/errors';
import { config } from '@/config/env';

const attestationsService = new AttestationsService();

export class AttestationsController {
  getAttestationByHash = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { hash } = (request.params as any);
    
    const attestation = await attestationsService.getAttestationByHash(hash);
    
    return success(reply, attestation);
  });

  getAttestationsByRound = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { roundId } = (request.params as any);
    
    const attestations = await attestationsService.getAttestationsByRound(roundId);
    
    return success(reply, attestations);
  });

  verifyAttestation = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { hash } = (request.params as any);
    
    const result = await attestationsService.verifyAttestationManually(hash);
    
    return success(reply, result, 'Attestation verification completed');
  });

  getAttestationProof = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { hash } = (request.params as any);
    
    // Get cached attestation for performance
    const attestation = await attestationsService.getCachedAttestation(hash);
    
    const proof = {
      hash: attestation.hash,
      inputsHash: attestation.payload?.inputsHash,
      codeMeasurement: attestation.payload?.codeMeasurement,
      signature: attestation.signature,
      verifiedAt: attestation.payload?.verifiedAt,
      verified: attestation.verified,
      txHash: attestation.txHash,
      solanaExplorer: attestation.txHash ? 
        `https://explorer.solana.com/tx/${attestation.txHash}?cluster=devnet` : null,
      payload: attestation.payload,
    };
    
    return success(reply, proof);
  });

  getAttestationStats = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { marketId } = request.query as any;
    
    const stats = await attestationsService.getAttestationStats(marketId);
    
    return success(reply, stats);
  });

  verifyteeIntegrity = asyncHandler(async (_request: FastifyRequest, reply: FastifyReply) => {
    const { verifyTeeRpcIntegrity } = await import('@magicblock-labs/ephemeral-rollups-sdk/privacy');
    const ok = await verifyTeeRpcIntegrity(config.TEE_RPC_URL);
    return success(reply, { verified: ok, endpoint: config.TEE_RPC_URL });
  });
}
