import { Queue, Worker, QueueOptions, WorkerOptions } from 'bullmq';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

const redisUrl = new URL(config.REDIS_URL);
export const queueConnection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
};

export const defaultQueueOptions: QueueOptions = {
  connection: queueConnection,
  skipVersionCheck: true,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 1000,
    },
  },
};

export const defaultWorkerOptions: WorkerOptions = {
  connection: queueConnection,
  concurrency: 5,
  skipVersionCheck: true,
};

export function createQueue<T = any>(name: string, options?: Partial<QueueOptions>): Queue<T> {
  const queue = new Queue<T>(name, {
    ...defaultQueueOptions,
    ...options,
  });

  queue.on('error', (error) => {
    logger.error({ queue: name, error }, 'Queue error');
  });

  return queue;
}

export function createWorker<T = any>(
  name: string,
  processor: (job: any) => Promise<void>,
  options?: Partial<WorkerOptions>
): Worker<T> {
  const worker = new Worker<T>(
    name,
    processor,
    {
      ...defaultWorkerOptions,
      ...options,
    }
  );

  worker.on('completed', (job) => {
    logger.info({ queue: name, jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ queue: name, jobId: job?.id, error: err }, 'Job failed');
  });

  worker.on('error', (error) => {
    logger.error({ queue: name, error }, 'Worker error');
  });

  return worker;
}
