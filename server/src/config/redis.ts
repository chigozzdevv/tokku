import Redis from 'ioredis';
import { config } from './env';
import { logger } from '@/utils/logger';

let redis: Redis;

export function connectRedis() {
  redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redis.on('connect', () => {
    logger.info('[Redis] Connected successfully');
  });

  redis.on('error', (error: Error) => {
    logger.error({ err: error }, 'Redis connection error');
  });

  return redis.connect().catch((error: Error) => {
    logger.fatal({ err: error }, 'Redis connection failed');
    throw error;
  });
}

export { redis };

export const redisKeys = {
  round: (roundId: string) => `round:${roundId}`,
  roundBets: (roundId: string) => `round:${roundId}:bets`,
  betCount: (roundId: string) => `round:${roundId}:bet-count`,
  userSession: (userId: string) => `session:${userId}`,
  leaderboard: 'leaderboard',
  activeStreaks: 'streaks:active',
  attestation: (hash: string) => `attestation:${hash}`,
  communityRound: (roundId: string) => `community:${roundId}`,
  entropyCache: (source: string) => `entropy:${source}`,
  rateLimit: (identifier: string) => `rate-limit:${identifier}`,
  authNonce: (pubkey: string) => `auth:nonce:${pubkey}`,
};
