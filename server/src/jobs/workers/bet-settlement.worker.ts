import { Job } from 'bullmq';
import { createWorker } from '../queue-config';
import { Round, Bet, LeaderboardEntry } from '@/config/database';
import { BetStatus, RoundStatus } from '@/shared/types';
import { logger } from '@/utils/logger';
import { SettleBetsJobData } from '../queues';
import { TokkuProgramService } from '@/solana/tokku-program-service';
import { getMarketConfig } from '@/utils/market-config';
import { getAdminKeypair } from '@/config/admin-keypair';
import { PublicKey } from '@solana/web3.js';

const tokkuProgram = new TokkuProgramService();

async function processBetSettlementJob(job: Job<SettleBetsJobData>) {
  const { roundId } = job.data;
  logger.info({ roundId }, 'Processing bet settlement job');

  try {
    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();
    const pendingBets = await Bet.find({ roundId, status: BetStatus.PENDING })
      .populate({ path: 'userId', select: 'walletAddress', model: 'User' })
      .lean();

    if (!round || !(round as any).outcome) {
      throw new Error(`Round ${roundId} not found or outcome not available`);
    }

    const outcome = typeof (round as any).outcome === 'string' ? JSON.parse((round as any).outcome as any) : (round as any).outcome;

    const marketCfg = getMarketConfig((round as any).marketId.config as unknown);
    if (!marketCfg.mintAddress) {
      throw new Error('Missing mintAddress in market config');
    }

    const adminKeypair = getAdminKeypair();
    const marketPubkey = new PublicKey(marketCfg.solanaAddress);
    const mint = new PublicKey(marketCfg.mintAddress);

    const isDelegated = Boolean((round as any).delegateTxHash && !(round as any).undelegateTxHash);

    if (isDelegated) {
      const maxUndelegateAttempts = 3;
      let undelegated = false;
      for (let attempt = 0; attempt < maxUndelegateAttempts && !undelegated; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
          const { erTxHash, baseTxHash } = await tokkuProgram.commitAndUndelegateRoundER(
            marketPubkey,
            (round as any).roundNumber,
            adminKeypair
          );
          await Round.updateOne({ _id: roundId }, { $set: { undelegateTxHash: erTxHash, baseLayerUndelegateTxHash: baseTxHash } });
          logger.info({ roundId, erTxHash, baseTxHash, attempt }, 'Round undelegated before settlement');
          undelegated = true;
        } catch (e) {
          logger.warn({ roundId, attempt, err: e }, 'Undelegate before settlement failed; retrying');
        }
      }
    }

    for (const bet of pendingBets as any[]) {
      const won = checkBetWon(bet.selection as any, outcome, (round as any).marketId.type);
      const payout = won ? Number(bet.stake) * Number(bet.odds) : 0;

      const userPk = new PublicKey(bet.userId.walletAddress);
      await tokkuProgram.settleBet(
        marketPubkey,
        round.roundNumber,
        userPk,
        mint,
        adminKeypair
      );

      await Bet.updateOne({ _id: bet._id }, { $set: { status: won ? BetStatus.WON : BetStatus.LOST, payout } });

      if (won) {
        await updateLeaderboard(String(bet.userId._id ?? bet.userId), Number(bet.stake), payout);
      } else {
        await LeaderboardEntry.findOneAndUpdate(
          { userId: bet.userId._id ?? bet.userId },
          {
            $setOnInsert: { userId: bet.userId._id ?? bet.userId, totalBets: 0, totalWon: 0, totalStake: 0, totalPayout: 0, winRate: 0, streak: 0 },
            $inc: { totalBets: 1, totalStake: Number(bet.stake) },
          },
          { upsert: true }
        );
      }

      logger.info({ betId: bet._id, won, payout }, 'Bet settled (on-chain + DB)');
    }

    await Round.updateOne({ _id: roundId }, { $set: { status: RoundStatus.SETTLED } });

    try {
      await tokkuProgram.settleRound(marketPubkey, round.roundNumber, adminKeypair);
    } catch (e) {
      logger.error({ roundId, err: e }, 'On-chain round settle failed');
    }

    const refreshed = await Round.findById(roundId).lean();
    const stillDelegated = Boolean((refreshed as any)?.delegateTxHash && !(refreshed as any)?.undelegateTxHash);
    if (stillDelegated) {
      const maxUndelegateAttempts = 3;
      let undelegated = false;
      for (let attempt = 0; attempt < maxUndelegateAttempts && !undelegated; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
          const { erTxHash, baseTxHash } = await tokkuProgram.commitAndUndelegateRoundER(
            marketPubkey,
            (round as any).roundNumber,
            adminKeypair
          );
          await Round.updateOne({ _id: roundId }, { $set: { undelegateTxHash: erTxHash, baseLayerUndelegateTxHash: baseTxHash, settledAt: new Date() } });
          logger.info({ roundId, erTxHash, baseTxHash, attempt }, 'Round committed and undelegated on base layer');
          undelegated = true;
        } catch (e) {
          logger.error({ roundId, err: e, attempt, maxUndelegateAttempts }, `Commit and undelegate failed (attempt ${attempt + 1}/${maxUndelegateAttempts})`);
          if (attempt === maxUndelegateAttempts - 1) {
            await Round.updateOne({ _id: roundId }, { $set: { settledAt: new Date() } });
            logger.error({ roundId }, 'CRITICAL: Round failed to undelegate after all retries');
          }
        }
      }
    }

    logger.info({ roundId }, 'All bets settled for round');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ roundId, error: errorMessage }, 'Bet settlement failed, attempting refunds');

    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();
    if (!round) {
      logger.error({ roundId }, 'Bet settlement failed and round not found for refund');
      return;
    }

    const marketCfg = getMarketConfig((round as any).marketId.config as unknown);
    if (!marketCfg.mintAddress) {
      logger.error({ roundId }, 'Bet settlement failed and mintAddress missing; skipping on-chain refunds');
    }

    const pending = await Bet.find({ roundId, status: BetStatus.PENDING })
      .populate({ path: 'userId', select: 'walletAddress', model: 'User' })
      .lean();

    if (pending.length > 0) {
      const adminKeypair = getAdminKeypair();
      const marketPubkey = new PublicKey(marketCfg.solanaAddress);
      const mint = marketCfg.mintAddress ? new PublicKey(marketCfg.mintAddress) : null;

      for (const bet of pending as any[]) {
        const wallet = bet.userId?.walletAddress;
        if (!wallet || !mint) {
          logger.error({ betId: bet._id, roundId }, 'Skipping on-chain refund: missing wallet or mint');
        } else {
          try {
            const userPk = new PublicKey(wallet);
            await tokkuProgram.refundBet(
              marketPubkey,
              (round as any).roundNumber,
              userPk,
              mint,
              adminKeypair
            );
            logger.info({ betId: bet._id, roundId }, 'On-chain refund completed after settlement failure');
          } catch (refundErr: any) {
            const refundMsg = refundErr instanceof Error ? refundErr.message : String(refundErr);
            logger.error({ betId: bet._id, roundId, error: refundMsg }, 'On-chain refund failed after settlement failure');
          }
        }

        await Bet.updateOne(
          { _id: bet._id },
          { $set: { status: BetStatus.REFUNDED, payout: Number(bet.stake) } }
        );
        logger.info({ betId: bet._id, roundId }, 'Bet marked refunded in database after settlement failure');
      }

      await Round.updateOne(
        { _id: roundId },
        { $set: { status: RoundStatus.FAILED, settledAt: new Date() } }
      );
      logger.error({ roundId }, 'Round marked FAILED after settlement failure and refunds');
    }
  }
}

function checkBetWon(selection: any, outcome: any, marketType: string): boolean {
  if (outcome.Numeric) {
    const value = outcome.Numeric.value;

    switch (selection.type) {
      case 'range':
        return value >= selection.min && value <= selection.max;
      case 'single':
        return value === selection.value;
      case 'parity':
        return (value % 2 === 0 && selection.value === 'even') ||
               (value % 2 === 1 && selection.value === 'odd');
      case 'digit':
        return value % 10 === selection.value;
      case 'modulo':
        return value % 3 === selection.value;
      default:
        return false;
    }
  }

  if (outcome.Shape) {
    return selection.type === 'shape' &&
           selection.shape === outcome.Shape.shape &&
           (!selection.color || selection.color === outcome.Shape.color);
  }

  if (outcome.Pattern) {
    return selection.type === 'pattern' &&
           selection.patternId === outcome.Pattern.pattern_id;
  }

  if (outcome.Entropy) {
    return selection.type === 'entropy' &&
           outcome.Entropy.winner === parseEntropySource(selection.source);
  }

  if (outcome.Community) {
    return selection.type === 'community' &&
           selection.byte === outcome.Community.final_byte;
  }

  return false;
}

function parseEntropySource(source: string): number {
  switch (source) {
    case 'tee': return 0;
    case 'chain': return 1;
    case 'sensor': return 2;
    default: return -1;
  }
}

async function updateLeaderboard(userId: string, stake: number, payout: number) {
  await LeaderboardEntry.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: { userId, totalBets: 0, totalWon: 0, totalStake: 0, totalPayout: 0, winRate: 0, streak: 0 },
      $inc: { totalBets: 1, totalWon: 1, totalStake: stake, totalPayout: payout },
    },
    { upsert: true }
  );
}

export const betSettlementWorker = createWorker<SettleBetsJobData>(
  'bet-settlement',
  processBetSettlementJob
);
