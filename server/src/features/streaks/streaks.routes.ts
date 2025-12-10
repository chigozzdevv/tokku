import { FastifyInstance } from 'fastify';
import { StreaksController } from './streaks.controller';

const streaksController = new StreaksController();

export async function streaksRoutes(fastify: FastifyInstance) {
  // All streak routes require authentication
  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.verifyJWT(request, reply);
  });

  fastify.post(
    '/create',
    {
      schema: {
        tags: ['Streaks'],
        summary: 'Start a new streak',
        description: 'Start a new win streak challenge',
        body: {
          type: 'object',
          properties: {
            marketId: { type: 'string' },
            target: { type: 'number', minimum: 2, maximum: 5 },
          },
        },
      },
    },
    streaksController.createStreak
  );

  fastify.get(
    '/my-streaks',
    {
      schema: {
        tags: ['Streaks'],
        summary: 'Get user streaks',
        description: 'Get all streaks for the authenticated user',
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ACTIVE', 'COMPLETED', 'FAILED'] },
          },
        },
      },
    },
    streaksController.getUserStreaks
  );

  fastify.get(
    '/active',
    {
      schema: {
        tags: ['Streaks'],
        summary: 'Get active streak',
        description: 'Get current active streak for the user',
        querystring: {
          type: 'object',
          properties: {
            marketId: { type: 'string' },
          },
        },
      },
    },
    streaksController.getActiveStreak
  );

  fastify.get(
    '/leaderboard',
    {
      schema: {
        tags: ['Streaks'],
        summary: 'Get streak leaderboard',
        description: 'Get top streak performers',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    streaksController.getStreakLeaderboard
  );

  fastify.get(
    '/odds',
    {
      schema: {
        tags: ['Streaks'],
        summary: 'Get streak odds',
        description: 'Get odds for different streak targets',
        querystring: {
          type: 'object',
          properties: {
            target: { type: 'number', minimum: 2, maximum: 5 },
          },
          required: ['target'],
        },
      },
    },
    streaksController.getStreakOdds
  );

  fastify.get(
    '/stats',
    {
      schema: {
        tags: ['Streaks'],
        summary: 'Get streak statistics',
        description: 'Get user streak performance statistics',
      },
    },
    streaksController.getStreakStats
  );

  fastify.post(
    '/validate',
    {
      schema: {
        tags: ['Streaks'],
        summary: 'Validate streak bet',
        description: 'Validate if user can place a streak bet',
        body: {
          type: 'object',
          properties: {
            target: { type: 'number', minimum: 2, maximum: 5 },
            stake: { type: 'number', minimum: 0.01 },
          },
          required: ['target', 'stake'],
        },
      },
    },
    streaksController.validateStreakBet
  );
}
