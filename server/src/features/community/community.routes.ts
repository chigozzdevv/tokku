import { FastifyInstance } from 'fastify';
import { CommunityController } from './community.controller';

const communityController = new CommunityController();

export async function communityRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.verifyJWT(request, reply);
  });

  fastify.post(
    '/join',
    {
      schema: {
        tags: ['Community'],
        summary: 'Join community round',
        description: 'Join a community round with your byte contribution',
        body: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
            byte: { type: 'number', minimum: 0, maximum: 255 },
          },
          required: ['roundId', 'byte'],
        },
      },
    },
    communityController.joinCommunityRound
  );

  fastify.get(
    '/round/:roundId/participants',
    {
      schema: {
        tags: ['Community'],
        summary: 'Get round participants',
        description: 'Get all participants in a community round',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    communityController.getCommunityRoundParticipants
  );

  fastify.get(
    '/round/:roundId/realtime',
    {
      schema: {
        tags: ['Community'],
        summary: 'Get real-time participants',
        description: 'Get real-time participant list from cache',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    communityController.getRealTimeParticipants
  );

  fastify.get(
    '/my-history',
    {
      schema: {
        tags: ['Community'],
        summary: 'Get user community history',
        description: 'Get user\'s community round participation history',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    communityController.getUserCommunityHistory
  );

  fastify.get(
    '/stats',
    {
      schema: {
        tags: ['Community'],
        summary: 'Get community statistics',
        description: 'Get community round participation statistics',
      },
    },
    communityController.getCommunityStats
  );

  fastify.get(
    '/leaderboard',
    {
      schema: {
        tags: ['Community'],
        summary: 'Get community leaderboard',
        description: 'Get top community round performers',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    communityController.getCommunityLeaderboard
  );

  // Admin route for finalizing rounds
  fastify.post(
    '/round/:roundId/finalize',
    {
      schema: {
        tags: ['Community (Admin)'],
        summary: 'Finalize community round',
        description: 'Finalize a community round and determine winners',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    communityController.finalizeCommunityRound
  );
}
