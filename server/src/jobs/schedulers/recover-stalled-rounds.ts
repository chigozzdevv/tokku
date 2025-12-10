import { Round, Bet } from '@/config/database';
import { RoundStatus } from '@/shared/types';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { roundLifecycleQueue } from '../queues';

const ACTIVE_JOB_STATES = new Set(['active', 'waiting', 'delayed']);

async function requeueLockJob(roundId: string) {
  const jobId = `lock-${roundId}`;
  const existingJob = await roundLifecycleQueue.getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState();
    if (ACTIVE_JOB_STATES.has(state)) {
      return false;
    }

    try {
      await existingJob.remove();
    } catch (error) {
      logger.error({ roundId, jobId, error }, 'Failed to remove stale lock job');
      return false;
    }
  }

  await roundLifecycleQueue.add('lock-round', { roundId }, { jobId });
  return true;
}

export async function recoverStalledRounds() {
  try {
    const now = Date.now();
    const predictingGraceMs = (config.ROUND_DURATION_SECONDS + config.LOCK_DURATION_SECONDS + 60) * 1000;
    const queuedGraceMs = (config.ROUND_RELEASE_INTERVAL_SECONDS + config.ROUND_QUEUE_BUFFER_SECONDS + 60) * 1000;

    const predictingCutoff = new Date(now - predictingGraceMs);
    const queuedCutoff = new Date(now - queuedGraceMs);

    const stalePredicting = await Round.find({
      status: RoundStatus.PREDICTING,
      openedAt: { $lte: predictingCutoff },
    }).select('_id openedAt marketId roundNumber').lean();

    for (const round of stalePredicting) {
      const roundId = String((round as any)._id);
      const requeued = await requeueLockJob(roundId);
      if (requeued) {
        logger.warn(
          { roundId, openedAt: round.openedAt, marketId: round.marketId, roundNumber: round.roundNumber },
          'Recovered stale predicting round by re-queuing lock job'
        );
      }
    }

    const staleQueued = await Round.find({
      status: RoundStatus.QUEUED,
      queuedAt: { $lte: queuedCutoff },
    }).select('_id queuedAt marketId roundNumber releaseGroupId scheduledReleaseAt').lean();

    if (staleQueued.length > 0) {
      const ids = staleQueued.map((round) => (round as any)._id);
      const betCounts = await Bet.aggregate<{ _id: string; count: number }>([
        { $match: { roundId: { $in: ids } } },
        { $group: { _id: '$roundId', count: { $sum: 1 } } },
      ]);
      const roundIdHasBets = new Map<string, number>();
      for (const entry of betCounts) {
        roundIdHasBets.set(String(entry._id), entry.count);
      }

      const toFail = ids.filter((id) => !roundIdHasBets.has(String(id)));
      if (toFail.length > 0) {
        await Round.updateMany(
          { _id: { $in: toFail } },
          {
            $set: {
              status: RoundStatus.FAILED,
              settledAt: new Date(),
            },
          }
        );
        logger.warn(
          {
            count: toFail.length,
            roundIds: toFail.map(String),
          },
          'Marked stale queued rounds with no bets as FAILED to unblock scheduling'
        );
      }

      const withBets = ids.filter((id) => roundIdHasBets.has(String(id)));
      if (withBets.length > 0) {
        logger.warn(
          {
            count: withBets.length,
            roundIds: withBets.map(String),
          },
          'Stale queued rounds with bets detected; leaving untouched for manual review'
        );
      }
    }
  } catch (error) {
    logger.error({ error }, 'Failed to recover stalled rounds');
  }
}
