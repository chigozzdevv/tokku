import type { Worker } from 'bullmq';
import { autoOpenRounds, releaseQueuedRounds, cleanupOldRounds, recoverStalledRounds } from './schedulers';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

let autoOpenInterval: NodeJS.Timeout | null = null;
let releaseInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;
let recoveryInterval: NodeJS.Timeout | null = null;

let roundLifecycleWorker: Worker | null = null;
let betSettlementWorker: Worker | null = null;

export async function initializeJobs() {
  logger.info('Initializing background jobs...');

  if (!roundLifecycleWorker || !betSettlementWorker) {
    const workers = await import('./workers');
    roundLifecycleWorker = workers.roundLifecycleWorker;
    betSettlementWorker = workers.betSettlementWorker;
    logger.info('Round lifecycle worker started');
    logger.info('Bet settlement worker started');
  }

  await autoOpenRounds();
  await releaseQueuedRounds();
  await recoverStalledRounds();

  autoOpenInterval = setInterval(autoOpenRounds, config.ROUND_RELEASE_INTERVAL_SECONDS * 1000);
  releaseInterval = setInterval(releaseQueuedRounds, config.ROUND_RELEASE_POLL_SECONDS * 1000);
  cleanupInterval = setInterval(cleanupOldRounds, 60 * 60 * 1000);
  const recoveryIntervalMs = Math.max(60000, config.ROUND_RELEASE_POLL_SECONDS * 1000);
  recoveryInterval = setInterval(recoverStalledRounds, recoveryIntervalMs);
  logger.info({ intervalSeconds: config.ROUND_RELEASE_INTERVAL_SECONDS }, 'Auto-open scheduler started');
  logger.info({ intervalSeconds: config.ROUND_RELEASE_POLL_SECONDS }, 'Release queued scheduler started');
  logger.info('Cleanup old rounds scheduler started (interval: 1h)');
  logger.info({ intervalMs: recoveryIntervalMs }, 'Stalled round recovery scheduler started');

  logger.info('All background jobs initialized');
}

export async function shutdownJobs() {
  logger.info('Shutting down background jobs...');

  if (autoOpenInterval) {
    clearInterval(autoOpenInterval);
    autoOpenInterval = null;
  }
  if (releaseInterval) {
    clearInterval(releaseInterval);
    releaseInterval = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }

  await Promise.all([
    roundLifecycleWorker?.close(),
    betSettlementWorker?.close(),
  ]);

  logger.info('All background jobs shut down');
}
