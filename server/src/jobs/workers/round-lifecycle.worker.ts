import { Job, UnrecoverableError } from 'bullmq';
import { createWorker } from '../queue-config';
import { RoundsService } from '@/features/rounds/rounds.service';
import { logger } from '@/utils/logger';
import { RevealOutcomeJobData, LockRoundJobData, UndelegateRoundJobData } from '../queues';
import { ConflictError } from '@/shared/errors';

const roundsService = new RoundsService();

async function processRoundLifecycleJob(job: Job) {
  const { name, data } = job;

  try {
    switch (name) {
      case 'reveal-outcome':
        await handleRevealOutcome(data as RevealOutcomeJobData);
        break;
      case 'lock-round':
        await handleLockRound(data as LockRoundJobData);
        break;
      case 'undelegate-round':
        await handleUndelegateRound(data as UndelegateRoundJobData);
        break;
      default:
        throw new Error(`Unknown job type: ${name}`);
    }
  } catch (error) {
    if (error instanceof ConflictError) {
      logger.debug({ jobId: job.id, error: error.message }, 'Job conflict - already processed, skipping retry');
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
}

async function handleRevealOutcome(data: RevealOutcomeJobData) {
  const { roundId } = data;
  logger.info({ roundId }, 'Processing reveal outcome job');
  await roundsService.revealOutcome(roundId);
}

async function handleLockRound(data: LockRoundJobData) {
  const { roundId } = data;
  logger.info({ roundId }, 'Processing lock round job');
  await roundsService.lockRound(roundId);
}

async function handleUndelegateRound(data: UndelegateRoundJobData) {
  const { roundId } = data;
  logger.info({ roundId }, 'Processing undelegate round job');
  await roundsService.undelegateRound(roundId);
}

export const roundLifecycleWorker = createWorker(
  'round-lifecycle',
  processRoundLifecycleJob,
  { concurrency: 1 }
);
