import { Market, Round, Bet } from '@/config/database';
import { RoundStatus } from '@/shared/types';
import { NotFoundError, ConflictError } from '@/shared/errors';
import { TokkuProgramService } from '@/solana/tokku-program-service';
import { TeeService } from '@/solana/tee-service';
import { getAdminKeypair } from '@/config/admin-keypair';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getMarketConfig } from '@/utils/market-config';
import { roundLifecycleQueue, betSettlementQueue } from '@/jobs/queues';
import { fetchRoundStateRaw } from '@/solana/round-reader';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const tokkuProgram = new TokkuProgramService();
const teeService = new TeeService();

export class RoundsService {
  async queueRound(marketId: string, scheduledReleaseAt: Date, releaseGroupId: string) {
    const market = await Market.findById(marketId).lean();
    if (!market) {
      throw new NotFoundError('Market');
    }

    if (!market.isActive) {
      throw new ConflictError('Market is not active');
    }

    const conflictingRound = await Round.findOne({
      marketId,
      status: { $in: [RoundStatus.PREDICTING, RoundStatus.QUEUED] },
    }).lean();

    if (conflictingRound) {
      logger.debug({ marketId, roundId: conflictingRound._id?.toString(), status: conflictingRound.status }, 'Market already has queued or active round, skipping queue');
      return conflictingRound;
    }

    const lastRound = await Round.findOne({ marketId }).sort({ roundNumber: -1 }).lean();

    const nextRoundNumber = (lastRound?.roundNumber || 0) + 1;

    const round = await Round.create({
      marketId,
      roundNumber: nextRoundNumber,
      status: RoundStatus.QUEUED,
      queuedAt: new Date(),
      scheduledReleaseAt,
      releaseGroupId,
    });

    logger.info({ marketId, roundId: (round as any)._id?.toString(), releaseGroupId, scheduledReleaseAt }, 'Queued round for batch release');
    return round;
  }

  async releaseQueuedRound(roundId: string) {
    const queuedRound = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' });

    if (!queuedRound) {
      throw new NotFoundError('Round');
    }

    if ((queuedRound as any).status !== RoundStatus.QUEUED) {
      logger.debug({ roundId, status: queuedRound.status }, 'Round not queued, skipping release');
      return queuedRound;
    }

    const mref = (queuedRound as any).marketId;
    const marketId = typeof mref === 'object' && mref !== null ? String(mref._id ?? mref) : String(mref);

    const active = await Round.findOne({ marketId, status: RoundStatus.PREDICTING }).lean();
    if (active) {
      logger.debug({ roundId, marketId, activeRoundId: active._id?.toString() }, 'Active round exists; skipping queued release');
      return queuedRound as any;
    }
    return this.openRound(marketId, { queuedRound: queuedRound as any });
  }

  async openRound(marketId: string, options?: { queuedRound?: any }) {
    const queuedRound = options?.queuedRound ?? null;
    const market = queuedRound?.marketId ?? await Market.findById(marketId).lean();
    if (!market) {
      throw new NotFoundError('Market');
    }

    if (!market.isActive) {
      throw new ConflictError('Market is not active');
    }

    if (!queuedRound) {
      const predicting = await Round.findOne({ marketId, status: RoundStatus.PREDICTING }).lean();
      if (predicting) {
        throw new ConflictError('Market already has an active round');
      }
    }

    const adminKeypair = getAdminKeypair();
    const marketConfig = getMarketConfig((market as any).config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    let marketState: { lastRound: number; isActive: boolean } | null = null;
    {
      const maxAttempts = 5;
      let lastErr: any;
      for (let i = 0; i < maxAttempts; i++) {
        try {
          marketState = await tokkuProgram.getMarketState(marketPubkey);
          break;
        } catch (e: any) {
          lastErr = e;
          const msg = String(e?.message || '');
          if (msg.includes('fetch failed') || msg.includes('UND_ERR_CONNECT_TIMEOUT')) {
            await new Promise((r) => setTimeout(r, 300 * (i + 1)));
            continue;
          }
          throw e;
        }
      }
      if (!marketState) throw lastErr || new Error('Failed to fetch market state');
    }

    if (!marketState.isActive) {
      throw new ConflictError('Market is not active on-chain');
    }

    const lastRound = await Round.findOne({ marketId }).sort({ roundNumber: -1 }).lean();

    const desiredRound = queuedRound?.roundNumber ?? (lastRound?.roundNumber || 0) + 1;
    const nextOnChainRound = marketState.lastRound + 1;
    let roundNumber = Math.max(desiredRound, nextOnChainRound);

    const syncQueuedRoundNumber = async () => {
      if (queuedRound && queuedRound.roundNumber !== roundNumber) {
        await Round.updateOne({ _id: (queuedRound as any)._id }, { $set: { roundNumber } });
      }
    };

    await syncQueuedRoundNumber();

    let roundPda: PublicKey | null = null;
    let signature: string | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const res = await tokkuProgram.openRound(marketPubkey, roundNumber, adminKeypair);
        signature = res.signature;
        roundPda = res.roundPda;
        break;
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || '');
        if (msg.includes('2006') || msg.includes('ConstraintSeeds')) {
          const refreshedState = await tokkuProgram.getMarketState(marketPubkey);
          roundNumber = Math.max(roundNumber + 1, refreshedState.lastRound + 1);
          await syncQueuedRoundNumber();
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        throw e;
      }
    }

    if (!roundPda || !signature) {
      const detail = lastError instanceof Error ? lastError.message : lastError ? String(lastError) : 'unknown error';
      logger.error({ marketId, roundNumber, error: detail }, 'Failed to open round');
      throw new Error(`Failed to open round: ${detail}`);
    }

    const openedAt = new Date();

    if (queuedRound) {
      await Round.updateOne({ _id: (queuedRound as any)._id }, {
        $set: {
          roundNumber,
          status: RoundStatus.PREDICTING,
          openedAt,
          releasedAt: openedAt,
          solanaAddress: roundPda.toString(),
          openTxHash: signature,
        },
      });
    } else {
      await Round.updateOne(
        { marketId, roundNumber },
        {
          $setOnInsert: {
            marketId,
            roundNumber,
          },
          $set: {
            status: RoundStatus.PREDICTING,
            openedAt,
            releasedAt: openedAt,
            solanaAddress: roundPda.toString(),
            openTxHash: signature,
            scheduledReleaseAt: null,
            releaseGroupId: null,
            queuedAt: null,
          },
        },
        { upsert: true }
      );
    }

    await new Promise(r => setTimeout(r, 2000));
    const r = await Round.findOne({ marketId, roundNumber }, { _id: 1 }).lean();
    logger.info({ roundId: String(r?._id), roundNumber, signature }, 'Round opened');

    const final = await Round.findOne({ marketId, roundNumber }).lean();
    if (!final) return null as any;
    return {
      id: String(final._id),
      marketId: final.marketId,
      roundNumber: final.roundNumber,
      status: final.status,
      openedAt: final.openedAt,
      lockedAt: final.lockedAt,
      revealedAt: final.revealedAt,
      settledAt: final.settledAt,
      queuedAt: final.queuedAt,
      releasedAt: final.releasedAt,
      scheduledReleaseAt: final.scheduledReleaseAt,
      releaseGroupId: (final as any).releaseGroupId,
      solanaAddress: (final as any).solanaAddress,
      openTxHash: (final as any).openTxHash,
      commitTxHash: (final as any).commitTxHash,
      commitStateTxHash: (final as any).commitStateTxHash,
      revealTxHash: (final as any).revealTxHash,
      delegateTxHash: (final as any).delegateTxHash,
      undelegateTxHash: (final as any).undelegateTxHash,
      attestation: (final as any).attestation,
      outcome: (final as any).outcome,
      createdAt: (final as any).createdAt,
      updatedAt: (final as any).updatedAt,
    } as any;
  }

  async delegateRoundToER(roundId: string, marketPubkey: PublicKey) {
    const adminKeypair = getAdminKeypair();
    const round = await Round.findById(roundId).lean();

    if (!round) {
      throw new NotFoundError('Round');
    }

    const connection = new Connection(config.SOLANA_RPC_URL);
    const marketInfo = await connection.getAccountInfo(marketPubkey);
    if (!marketInfo) {
      throw new Error(`Market ${marketPubkey.toString()} not initialized on-chain`);
    }

    const marketDoc = await Market.findOne({ 'config.solanaAddress': marketPubkey.toString() }).lean();
    if (marketDoc) {
      const marketConfig = getMarketConfig((marketDoc as any).config as unknown);
      if (marketConfig.mintAddress) {
        const mint = new PublicKey(marketConfig.mintAddress);
        const vaultPda = await tokkuProgram.getVaultPda(marketPubkey);
        const vaultTokenAccount = await getAssociatedTokenAddress(mint, vaultPda, true);

        const vaultAtaInfo = await connection.getAccountInfo(vaultTokenAccount);

        if (!vaultAtaInfo) {
          logger.info({ marketPubkey: marketPubkey.toString(), vaultTokenAccount: vaultTokenAccount.toString() }, 'Creating vault token account before delegation');

          const createAtaIx = createAssociatedTokenAccountInstruction(
            adminKeypair.publicKey,
            vaultTokenAccount,
            vaultPda,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          );

          const tx = new Transaction().add(createAtaIx);
          const { blockhash } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = adminKeypair.publicKey;

          const sig = await connection.sendTransaction(tx, [adminKeypair], { skipPreflight: false });
          await connection.confirmTransaction(sig, 'confirmed');

          logger.info({ sig, vaultTokenAccount: vaultTokenAccount.toString() }, 'Vault token account created');
        }

        const erConnection = new Connection(config.EPHEMERAL_RPC_URL);
        const erVaultAtaInfo = await erConnection.getAccountInfo(vaultTokenAccount);
        if (!erVaultAtaInfo) {
          const createErAtaIx = createAssociatedTokenAccountInstruction(
            adminKeypair.publicKey,
            vaultTokenAccount,
            vaultPda,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          );
          const erTx = new Transaction().add(createErAtaIx);
          const { blockhash } = await erConnection.getLatestBlockhash();
          erTx.recentBlockhash = blockhash;
          erTx.feePayer = adminKeypair.publicKey;
          const erSig = await erConnection.sendTransaction(erTx, [adminKeypair], { skipPreflight: false });
          await erConnection.confirmTransaction(erSig, 'confirmed');
          logger.info({ sig: erSig, vaultTokenAccount: vaultTokenAccount.toString() }, 'Vault token account created on ER');
        }
      }
    }

    const delegateTxHash = await tokkuProgram.delegateRound(
      marketPubkey,
      round.roundNumber,
      adminKeypair
    );

    await Round.updateOne({ _id: roundId }, { $set: { delegateTxHash } });

    logger.info({ roundId, delegateTxHash }, 'Round delegated to ER');
  }

  async lockRound(roundId: string) {
    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();

    if (!round) {
      throw new NotFoundError('Round');
    }

    if (round.status === RoundStatus.SETTLED) {
      logger.info({ roundId, status: round.status }, 'Round already settled, skipping');
      return round.lockTxHash || 'already-settled';
    }
    if (round.status === RoundStatus.LOCKED) {
      logger.info({ roundId, status: round.status }, 'Round already locked; continuing pipeline if needed');

      const betCount = await Bet.countDocuments({ roundId });
      if (betCount === 0) {
        await Round.updateOne({ _id: roundId }, { $set: { status: RoundStatus.FAILED, settledAt: new Date() } });
        logger.info({ roundId }, 'Round expired (no bets)');
        return round.lockTxHash || 'already-locked';
      }

      if (!(round as any).attestation) {
        await this.prepareOutcome(roundId);
      }

      await this.commitPreparedOutcome(roundId);

      return round.lockTxHash || 'already-locked';
    }

    if (round.status !== RoundStatus.PREDICTING) {
      throw new ConflictError('Round is not in predicting state');
    }

    const adminKeypair = getAdminKeypair();
    const marketConfig = getMarketConfig((round as any).marketId.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);

    const isDelegated = Boolean((round as any).delegateTxHash && !(round as any).undelegateTxHash);

    let lockTxHash: string;
    try {
      lockTxHash = await tokkuProgram.lockRound(
        marketPubkey,
        round.roundNumber,
        adminKeypair,
        { useER: isDelegated }
      );
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('6002') || msg.includes('InvalidState')) {
        lockTxHash = 'already-locked';
      } else {
        throw e;
      }
    }

    await Round.updateOne({ _id: roundId }, { $set: { status: RoundStatus.LOCKED, lockedAt: new Date(), lockTxHash } });

    logger.info({ roundId, lockTxHash }, 'Round locked');

    const betCount = await Bet.countDocuments({ roundId });
    if (betCount === 0) {
      await Round.updateOne({ _id: roundId }, { $set: { status: RoundStatus.FAILED, settledAt: new Date() } });
      logger.info({ roundId }, 'Round expired (no bets)');
      return lockTxHash;
    }

    await this.prepareOutcome(roundId);
    await this.delegateRoundToER(roundId, marketPubkey);

    const refreshedRound = await Round.findById(roundId).lean();

    await this.commitPreparedOutcome(roundId);

    return lockTxHash;
  }

  async prepareOutcome(roundId: string) {
    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();

    if (!round) {
      throw new NotFoundError('Round');
    }

    const adminKeypair = getAdminKeypair();
    const marketConfig = getMarketConfig((round as any).marketId.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);

    const oracleQueue = new PublicKey(config.VRF_ORACLE_QUEUE);
    const clientSeed = round.roundNumber % 256;

    try {
      await tokkuProgram.requestRandomnessER(
        marketPubkey,
        round.roundNumber,
        clientSeed,
        adminKeypair,
        oracleQueue,
        { useER: false }
      );
      logger.info({ roundId, roundNumber: round.roundNumber }, 'VRF randomness requested');
    } catch (error: any) {
      const msg = String(error?.message || 'unknown error');
      if (!msg.includes('already')) {
        logger.error({ roundId, roundNumber: round.roundNumber, error: msg }, 'Failed to request VRF randomness');
        throw error;
      }
    }

    const roundPda = await tokkuProgram.getRoundPda(marketPubkey, round.roundNumber);
    const baseConnection = new Connection(config.SOLANA_RPC_URL);
    const erConnection = new Connection(config.EPHEMERAL_RPC_URL);
    const isZeroHex = (value: string | null) => !value || /^0+$/.test(value);

    let randomnessHex: string | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const [erState, baseState] = await Promise.all([
        fetchRoundStateRaw(erConnection, roundPda),
        fetchRoundStateRaw(baseConnection, roundPda),
      ]);
      const state = erState && !isZeroHex(erState.inputsHash) ? erState : baseState;
      if (state && state.inputsHash && !isZeroHex(state.inputsHash)) {
        randomnessHex = state.inputsHash;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!randomnessHex) {
      throw new Error('VRF randomness not received within timeout window');
    }

    const vrfRandomness = Buffer.from(randomnessHex, 'hex');
    if (vrfRandomness.length !== 32) {
      throw new Error('VRF randomness length mismatch');
    }

    const chainHash = await teeService.getLatestBlockhash();

    const attestation = await teeService.generateOutcome(
      roundId,
      (round as any).marketId.type,
      { chainHash, vrfRandomness }
    );

    const commitmentHash = Buffer.from(attestation.commitment_hash, 'hex');
    const attestationSig = Buffer.from(attestation.signature, 'hex');

    await Round.updateOne({ _id: roundId }, { $set: { attestation } });

    logger.info({ roundId }, 'Outcome attestation prepared');
  }

  async commitPreparedOutcome(roundId: string) {
    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();

    if (!round || !(round as any).attestation) {
      throw new NotFoundError('Round or attestation');
    }

    const attestation = typeof (round as any).attestation === 'string' ? JSON.parse((round as any).attestation as any) : (round as any).attestation;

    const adminKeypair = getAdminKeypair();
    const marketConfig = getMarketConfig((round as any).marketId.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);

    const commitmentHash = Buffer.from(attestation.commitment_hash, 'hex');
    const attestationSig = Buffer.from(attestation.signature, 'hex');

    const isDelegated = Boolean((round as any).delegateTxHash && !(round as any).undelegateTxHash);
    if (isDelegated) {
      await Round.updateOne({ _id: roundId }, { $set: { commitTxHash: 'er-skip' } });
      await roundLifecycleQueue.add('reveal-outcome', { roundId }, { jobId: `reveal-${roundId}`, delay: config.LOCK_DURATION_SECONDS * 1000 });
      return;
    }

    let commitTxHash: string | null = null;
    try {
      commitTxHash = await tokkuProgram.commitOutcomeHash(
        marketPubkey,
        round.roundNumber,
        commitmentHash,
        attestationSig,
        adminKeypair,
        { useER: false }
      );
      await Round.updateOne({ _id: roundId }, { $set: { commitTxHash } });
      logger.info({ roundId, commitTxHash }, 'Outcome hash committed (hidden until reveal)');

      const roundPda = await tokkuProgram.getRoundPda(marketPubkey, round.roundNumber);
      const baseConnection = new Connection(config.SOLANA_RPC_URL);
      const erConnection = new Connection(config.EPHEMERAL_RPC_URL);

      const maxAttempts = 12;
      let state: Awaited<ReturnType<typeof fetchRoundStateRaw>> | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const [erState, baseState] = await Promise.all([
          fetchRoundStateRaw(erConnection, roundPda),
          fetchRoundStateRaw(baseConnection, roundPda),
        ]);
        state = erState?.commitmentHash ? erState : baseState;
        if (state && state.commitmentHash) break;
        await new Promise((resolve) => setTimeout(resolve, 500 * Math.max(1, attempt + 1)));
      }

      if (!state || !state.commitmentHash) {
        logger.warn({ roundId, roundPda: roundPda.toBase58() }, 'Commit verification pending; state not yet available');
      } else if (state.commitmentHash.toLowerCase() !== attestation.commitment_hash.toLowerCase()) {
        throw new Error(`Commit verification failed: mismatch (expected ${attestation.commitment_hash}, on-chain ${state.commitmentHash})`);
      } else {
        logger.info({ roundId }, 'Commit verification passed');
      }

      await roundLifecycleQueue.add('reveal-outcome', { roundId }, { jobId: `reveal-${roundId}`, delay: config.LOCK_DURATION_SECONDS * 1000 });
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/InvalidAttestation|6016/i.test(msg)) {
        try {
          await this.delegateRoundToER(roundId, marketPubkey);
          await Round.updateOne({ _id: roundId }, { $set: { commitTxHash: 'er-skip' } });
          await roundLifecycleQueue.add('reveal-outcome', { roundId }, { delay: config.LOCK_DURATION_SECONDS * 1000 });
          return;
        } catch (err) {
          throw e;
        }
      }
      throw e;
    }
  }

  async revealOutcome(roundId: string) {
    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();

    if (!round || !round.attestation) {
      throw new NotFoundError('Round or attestation');
    }

    const attestation = typeof (round as any).attestation === 'string' ? JSON.parse((round as any).attestation as any) : (round as any).attestation;
    const outcome = attestation.outcome;

    const nonce = Buffer.from(attestation.nonce, 'hex');
    const inputsHash = Buffer.from(attestation.inputs_hash, 'hex');
    const attestationSig = Buffer.from(attestation.signature, 'hex');

    const adminKeypair = getAdminKeypair();
    const marketConfig = getMarketConfig((round as any).marketId.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);

    const isDelegated = Boolean((round as any).delegateTxHash && !(round as any).undelegateTxHash);
    let revealTxHash: string;

    if (outcome.Numeric) {
      revealTxHash = isDelegated
        ? await tokkuProgram.revealOutcomeER(marketPubkey, round.roundNumber, outcome.Numeric.value, adminKeypair)
        : await tokkuProgram.revealOutcome(marketPubkey, round.roundNumber, outcome.Numeric.value, nonce, inputsHash, attestationSig, adminKeypair);
    } else if (outcome.Shape) {
      revealTxHash = isDelegated
        ? await tokkuProgram.revealShapeOutcomeER(marketPubkey, round.roundNumber, outcome.Shape.shape, outcome.Shape.color, outcome.Shape.size, adminKeypair)
        : await tokkuProgram.revealShapeOutcome(marketPubkey, round.roundNumber, outcome.Shape.shape, outcome.Shape.color, outcome.Shape.size, nonce, inputsHash, attestationSig, adminKeypair);
    } else if (outcome.Pattern) {
      revealTxHash = isDelegated
        ? await tokkuProgram.revealPatternOutcomeER(marketPubkey, round.roundNumber, outcome.Pattern.pattern_id, outcome.Pattern.matched_value, adminKeypair)
        : await tokkuProgram.revealPatternOutcome(marketPubkey, round.roundNumber, outcome.Pattern.pattern_id, outcome.Pattern.matched_value, nonce, inputsHash, attestationSig, adminKeypair);
    } else if (outcome.Entropy) {
      revealTxHash = isDelegated
        ? await tokkuProgram.revealEntropyOutcomeER(marketPubkey, round.roundNumber, outcome.Entropy.tee_score, outcome.Entropy.chain_score, outcome.Entropy.sensor_score, adminKeypair)
        : await tokkuProgram.revealEntropyOutcome(marketPubkey, round.roundNumber, outcome.Entropy.tee_score, outcome.Entropy.chain_score, outcome.Entropy.sensor_score, outcome.Entropy.winner, nonce, inputsHash, attestationSig, adminKeypair);
    } else if (outcome.Community) {
      const seedHash = Buffer.from(outcome.Community.seed_hash, 'hex');
      revealTxHash = isDelegated
        ? await tokkuProgram.revealCommunityOutcomeER(marketPubkey, round.roundNumber, outcome.Community.final_byte, seedHash, adminKeypair)
        : await tokkuProgram.revealCommunityOutcome(marketPubkey, round.roundNumber, outcome.Community.final_byte, seedHash, nonce, inputsHash, attestationSig, adminKeypair);
    } else {
      throw new Error('Unsupported outcome type');
    }

    await Round.updateOne({ _id: roundId }, { $set: { revealTxHash, revealedAt: new Date(), status: RoundStatus.REVEALED, outcome } });

    logger.info({ roundId, revealTxHash }, 'Outcome revealed');

    try {
      const erConnection = new Connection(config.EPHEMERAL_RPC_URL);
      const baseConnection = new Connection(config.SOLANA_RPC_URL);
      const marketConfig = getMarketConfig((round as any).marketId.config as unknown);
      const marketPubkey = new PublicKey(marketConfig.solanaAddress);
      const roundPda = await tokkuProgram.getRoundPda(marketPubkey, round.roundNumber);

      const maxAttempts = 10;
      let state: Awaited<ReturnType<typeof fetchRoundStateRaw>> | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const [erState, baseState] = await Promise.all([
          fetchRoundStateRaw(erConnection, roundPda),
          fetchRoundStateRaw(baseConnection, roundPda),
        ]);
        state = (Boolean((round as any).delegateTxHash && !(round as any).undelegateTxHash)
          ? (erState || baseState)
          : (baseState || erState));
        if (state && state.outcome) break;
        await new Promise(r => setTimeout(r, 500));
      }

      const expectedInputs = Buffer.from(attestation.inputs_hash, 'hex').toString('hex');
      const normalizeOutcome = (value: any) => {
        if (!value) return null;
        if (value.Numeric) return { type: 'Numeric', value: value.Numeric.value };
        if (value.Shape) return { type: 'Shape', shape: value.Shape.shape, color: value.Shape.color, size: value.Shape.size };
        if (value.Pattern) return { type: 'Pattern', patternId: value.Pattern.pattern_id ?? value.Pattern.patternId, matchedValue: value.Pattern.matched_value ?? value.Pattern.matchedValue };
        if (value.Entropy) return { type: 'Entropy', tee: value.Entropy.tee_score, chain: value.Entropy.chain_score, sensor: value.Entropy.sensor_score, winner: value.Entropy.winner };
        if (value.Community) {
          const seed = value.Community.seed_hash;
          const seedHex = Array.isArray(seed) ? Buffer.from(seed).toString('hex') : (typeof seed === 'string' ? seed.toLowerCase() : '');
          return { type: 'Community', finalByte: value.Community.final_byte ?? value.Community.finalByte, seedHash: seedHex };
        }
        return { type: 'Unknown', raw: value };
      };

      if (!state || !state.outcome) {
        logger.warn({ roundId }, 'Reveal verification pending: state not yet available');
      } else {
        const normalizedState = normalizeOutcome(state.outcome);
        const normalizedExpected = normalizeOutcome(outcome);
        const outcomeMatches = normalizedState !== null && normalizedExpected !== null && JSON.stringify(normalizedState) === JSON.stringify(normalizedExpected);
        const inputsMatch = (state.inputsHash || '').toLowerCase() === expectedInputs.toLowerCase();

        if (!outcomeMatches) throw new Error('Reveal verification failed: outcome mismatch');
        // Only require inputsHash on base layer; ER will be committed shortly
        const isDelegated = Boolean((round as any).delegateTxHash && !(round as any).undelegateTxHash);
        if (!isDelegated && !inputsMatch) throw new Error('Reveal verification failed: inputsHash mismatch');
        logger.info({ roundId }, 'Reveal verification passed');
      }
    } catch (e: any) {
      logger.warn({ roundId, error: String(e?.message || e) }, 'Reveal verification failed; continuing to commit and settle');
    }

    await betSettlementQueue.add('settle-bets', { roundId }, { jobId: `settle-${roundId}` });
    await this.commitRoundStateToBase(roundId);
  }

  async commitRoundStateToBase(roundId: string) {
    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();

    if (!round) {
      throw new NotFoundError('Round');
    }

    if (!(round as any).delegateTxHash) {
      logger.info({ roundId }, 'Round not delegated, skipping commit');
      return;
    }

    const marketConfig = getMarketConfig((round as any).marketId.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    const adminKeypair = getAdminKeypair();

    const { erTxHash, baseTxHash } = await tokkuProgram.commitRoundStateER(
      marketPubkey,
      round.roundNumber,
      adminKeypair
    );

    await Round.updateOne({ _id: roundId }, { $set: { commitStateTxHash: erTxHash, baseLayerCommitTxHash: baseTxHash } });

    logger.info({ roundId, erTxHash, baseTxHash }, 'Round state committed to base layer');
  }

  async undelegateRound(roundId: string) {
    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();

    if (!round) {
      throw new NotFoundError('Round');
    }

    if (!(round as any).delegateTxHash) {
      await Round.updateOne({ _id: roundId }, { $set: { status: RoundStatus.SETTLED, settledAt: new Date() } });
      logger.warn({ roundId }, 'Round was never delegated, marked SETTLED without undelegation');
      return;
    }

    const marketConfig = getMarketConfig((round as any).marketId.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    const adminKeypair = getAdminKeypair();

    const { erTxHash, baseTxHash } = await tokkuProgram.commitAndUndelegateRoundER(
      marketPubkey,
      round.roundNumber,
      adminKeypair
    );

    await Round.updateOne({ _id: roundId }, { $set: { status: RoundStatus.SETTLED, undelegateTxHash: erTxHash, baseLayerUndelegateTxHash: baseTxHash, settledAt: new Date() } });

    logger.info({ roundId, erTxHash, baseTxHash }, 'Round undelegated and settled on base layer');

    return erTxHash;
  }

  async getRound(roundId: string) {
    const round = await Round.findById(roundId).lean();

    if (!round) {
      throw new NotFoundError('Round');
    }

    const [bets, market] = await Promise.all([
      Bet.find({ roundId: (round as any)._id }, { stake: 1, selection: 1, status: 1, createdAt: 1 }).lean(),
      Market.findById((round as any).marketId).select('name type config').lean(),
    ]);
    return {
      id: String((round as any)._id),
      marketId: (round as any).marketId,
      roundNumber: (round as any).roundNumber,
      status: (round as any).status,
      openedAt: (round as any).openedAt,
      lockedAt: (round as any).lockedAt,
      revealedAt: (round as any).revealedAt,
      settledAt: (round as any).settledAt,
      queuedAt: (round as any).queuedAt,
      releasedAt: (round as any).releasedAt,
      scheduledReleaseAt: (round as any).scheduledReleaseAt,
      releaseGroupId: (round as any).releaseGroupId,
      solanaAddress: (round as any).solanaAddress,
      openTxHash: (round as any).openTxHash,
      commitTxHash: (round as any).commitTxHash,
      commitStateTxHash: (round as any).commitStateTxHash,
      revealTxHash: (round as any).revealTxHash,
      delegateTxHash: (round as any).delegateTxHash,
      undelegateTxHash: (round as any).undelegateTxHash,
      attestation: (round as any).attestation,
      outcome: (round as any).outcome,
      createdAt: (round as any).createdAt,
      updatedAt: (round as any).updatedAt,
      market: market
        ? { id: String((market as any)._id), name: (market as any).name, type: (market as any).type, config: (market as any).config }
        : { id: String((round as any).marketId), name: '', type: '', config: {} },
      bets: bets.map((b: any) => ({ id: String(b._id), stake: Number(b.stake), selection: b.selection, status: b.status, createdAt: b.createdAt })),
    } as any;
  }

  async getActiveRounds(marketId?: string) {
    const query: any = { status: { $in: [RoundStatus.PREDICTING, RoundStatus.QUEUED] } };
    if (marketId) query.marketId = marketId;
    const rounds = await Round.find(query).sort({ openedAt: 1, scheduledReleaseAt: 1 }).lean();
    const marketIds = Array.from(new Set(rounds.map((r: any) => r.marketId)));
    const markets = await Market.find({ _id: { $in: marketIds } }).select('name type config').lean();
    const mMap = new Map(
      markets.map((m: any) => [String(m._id), { id: String(m._id), name: m.name, type: m.type, config: m.config }])
    );
    const betCounts = await Bet.aggregate([
      { $match: { roundId: { $in: rounds.map((r: any) => r._id) } } },
      { $group: { _id: '$roundId', c: { $sum: 1 } } },
    ]);
    const bMap = new Map(betCounts.map((r: any) => [String(r._id), r.c]));
    return rounds.map((r: any) => ({
      id: String(r._id),
      marketId: r.marketId,
      roundNumber: r.roundNumber,
      status: r.status,
      openedAt: r.openedAt,
      lockedAt: r.lockedAt,
      revealedAt: r.revealedAt,
      settledAt: r.settledAt,
      queuedAt: r.queuedAt,
      releasedAt: r.releasedAt,
      scheduledReleaseAt: r.scheduledReleaseAt,
      releaseGroupId: (r as any).releaseGroupId,
      solanaAddress: (r as any).solanaAddress,
      outcome: (r as any).outcome,
      market: mMap.get(String(r.marketId)),
      _count: { bets: bMap.get(String(r._id)) || 0 },
    }));
  }

  async getRoundAnalytics(roundId: string) {
    const round = await Round.findById(roundId).lean();
    if (!round) {
      throw new NotFoundError('Round');
    }

    const bets = await Bet.find({ roundId: (round as any)._id }).select('stake selection createdAt userId').lean();

    const totalBets = bets.length;
    const totalVolume = bets.reduce((sum, bet) => sum + Number(bet.stake), 0);
    const uniqueUsers = new Set(bets.map(b => String((b as any).userId))).size;

    const selectionMap = new Map<string, { bets: number; volume: number }>();
    bets.forEach((bet: any) => {
      const key = JSON.stringify(bet.selection);
      const existing = selectionMap.get(key) || { bets: 0, volume: 0 };
      existing.bets += 1;
      existing.volume += Number(bet.stake);
      selectionMap.set(key, existing);
    });

    const selections = Array.from(selectionMap.entries()).map(([selection, data]) => ({
      option: selection,
      bets: data.bets,
      volume: data.volume,
      percentage: totalBets > 0 ? (data.bets / totalBets) * 100 : 0
    }));

    const timelineMap = new Map<string, { bets: number; volume: number }>();
    bets.forEach((bet: any) => {
      if (!bet.createdAt) return;
      const timestamp = new Date(bet.createdAt);
      timestamp.setMinutes(Math.floor(timestamp.getMinutes() / 5) * 5, 0, 0);
      const key = timestamp.toISOString();
      const existing = timelineMap.get(key) || { bets: 0, volume: 0 };
      existing.bets += 1;
      existing.volume += Number(bet.stake);
      timelineMap.set(key, existing);
    });

    const timeline = Array.from(timelineMap.entries())
      .map(([time, data]) => ({ time, bets: data.bets, volume: data.volume }))
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    const userBetCounts = new Map<string, number>();
    bets.forEach((bet: any) => {
      const userId = String(bet.userId);
      userBetCounts.set(userId, (userBetCounts.get(userId) || 0) + 1);
    });

    const repeatBettors = Array.from(userBetCounts.values()).filter(count => count > 1).length;

    let topBettor = null;
    if (bets.length > 0) {
      const userVolumes = new Map<string, number>();
      bets.forEach((bet: any) => {
        const userId = String(bet.userId);
        userVolumes.set(userId, (userVolumes.get(userId) || 0) + Number(bet.stake));
      });
      const [topUserId, topVolume] = Array.from(userVolumes.entries()).reduce((max, entry) =>
        entry[1] > max[1] ? entry : max
      );
      topBettor = { userId: topUserId, volume: topVolume };
    }

    const betSizes = bets.map(b => Number(b.stake));
    const sortedSizes = betSizes.sort((a, b) => a - b);
    const betSizeDistribution = {
      min: sortedSizes[0] || 0,
      max: sortedSizes[sortedSizes.length - 1] || 0,
      median: sortedSizes[Math.floor(sortedSizes.length / 2)] || 0,
      avg: totalBets > 0 ? totalVolume / totalBets : 0
    };

    const openedTime = round.openedAt ? new Date(round.openedAt).getTime() : Date.now();
    const currentTime = Date.now();
    const duration = currentTime - openedTime;
    const firstHalfBets = bets.filter(b => b.createdAt && new Date(b.createdAt).getTime() < openedTime + duration / 2).length;
    const secondHalfBets = totalBets - firstHalfBets;

    let momentum: 'increasing' | 'stable' | 'decreasing' = 'stable';
    if (secondHalfBets > firstHalfBets * 1.2) momentum = 'increasing';
    else if (secondHalfBets < firstHalfBets * 0.8) momentum = 'decreasing';

    let peakTime = null;
    if (timeline.length > 0) {
      const peak = timeline.reduce((max, entry) => entry.bets > max.bets ? entry : max);
      peakTime = peak.time;
    }

    return {
      overview: {
        totalVolume,
        totalBets,
        uniqueUsers
      },
      timeline,
      selections,
      trends: {
        avgBetSize: betSizeDistribution.avg,
        peakTime,
        momentum
      },
      userParticipation: {
        uniqueUsers,
        repeatBettors,
        topBettor
      },
      betSizeDistribution
    };
  }

  async getProbabilityHistory(roundId: string) {
    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();
    if (!round) {
      throw new NotFoundError('Round');
    }

    const bets = await Bet.find({ roundId: (round as any)._id })
      .select('selection createdAt stake')
      .sort({ createdAt: 1 })
      .lean();

    if (bets.length === 0) {
      return [];
    }

    const openedTime = round.openedAt ? new Date(round.openedAt).getTime() : Date.now();
    const lastBet = bets[bets.length - 1];
    const latestBetTime = lastBet?.createdAt ? new Date(lastBet.createdAt).getTime() : Date.now();
    const duration = latestBetTime - openedTime;
    const intervalMs = Math.max(60000, Math.floor(duration / 20));

    const snapshots = [];
    let currentTime = openedTime;

    while (currentTime <= latestBetTime) {
      const betsUntilNow = bets.filter(b => b.createdAt && new Date(b.createdAt).getTime() <= currentTime);

      if (betsUntilNow.length > 0) {
        const selectionCounts = new Map<string, number>();
        betsUntilNow.forEach((bet: any) => {
          const key = JSON.stringify(bet.selection);
          selectionCounts.set(key, (selectionCounts.get(key) || 0) + 1);
        });

        const totalBetsAtTime = betsUntilNow.length;
        const probabilities = Array.from(selectionCounts.entries()).map(([selection, count]) => ({
          selection,
          probability: (count / totalBetsAtTime) * 100,
          bets: count
        }));

        snapshots.push({
          timestamp: new Date(currentTime).toISOString(),
          probabilities
        });
      }

      currentTime += intervalMs;
    }

    return snapshots;
  }
}
