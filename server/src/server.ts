import fastify from 'fastify';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { connectDatabase } from '@/config/database';
import { connectRedis } from '@/config/redis';
import { registerPlugins } from '@/config/plugins';
import { errorHandler } from '@/utils/errors';
import { authRoutes } from '@/features/auth';
import { marketsRoutes } from '@/features/markets';
import { roundsRoutes } from '@/features/rounds';
import { betsRoutes } from '@/features/bets';
import { attestationsRoutes } from '@/features/attestations';
import { streaksRoutes } from '@/features/streaks';
import { communityRoutes } from '@/features/community';
import { analyticsRoutes } from '@/features/analytics';
import { initializeJobs, shutdownJobs } from '@/jobs';

async function bootstrap() {
  const isDevelopment = config.NODE_ENV === 'development';
  const app = fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: isDevelopment
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
    trustProxy: true,
  });

  try {
    await registerPlugins(app);
    app.setErrorHandler(errorHandler);
    app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
    app.register(authRoutes, { prefix: '/api/v1/auth' });
    app.register(marketsRoutes, { prefix: '/api/v1/markets' });
    app.register(roundsRoutes, { prefix: '/api/v1/rounds' });
    app.register(betsRoutes, { prefix: '/api/v1/bets' });
    app.register(attestationsRoutes, { prefix: '/api/v1/attestations' });
    app.register(streaksRoutes, { prefix: '/api/v1/streaks' });
    app.register(communityRoutes, { prefix: '/api/v1/community' });
    app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });

    await connectDatabase();
    await connectRedis();

    const port = Number(config.PORT);
    await app.listen({ port, host: '0.0.0.0' });

    await initializeJobs();

    logger.info(`🚀 TOSSR.gg server running on port ${port}`);
    logger.info(`>> API documentation available at http://localhost:${port}/docs`);
    
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await shutdownJobs();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await shutdownJobs();
  process.exit(0);
});

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Bootstrap failed');
  process.exit(1);
});
