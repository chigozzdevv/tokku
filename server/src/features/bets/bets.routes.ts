import { FastifyInstance } from 'fastify';
import { BetsController } from './bets.controller';

const betsController = new BetsController();

export async function betsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.verifyJWT(request, reply);
  });

  fastify.post(
    '/place',
    {
      schema: {
        tags: ['Bets'],
        summary: 'Place a bet',
        description: 'Place a bet on an active round via MagicBlock ER',
        body: {
          type: 'object',
          required: ['roundId', 'selection', 'stake'],
          properties: {
            roundId: { type: 'string', minLength: 1 },
            selection: { type: 'object' },
            stake: { type: 'number', minimum: 0, maximum: 100000000000 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  transaction: { type: 'string' },
                  betPda: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    betsController.placeBet
  );

  fastify.post(
    '/confirm',
    {
      schema: {
        tags: ['Bets'],
        summary: 'Confirm bet transaction',
        description: 'Confirm bet after signing and submitting transaction',
        body: {
          type: 'object',
          required: ['roundId', 'selection', 'stake', 'txSignature', 'betPda'],
          properties: {
            roundId: { type: 'string', minLength: 1 },
            selection: { type: 'object' },
            stake: { type: 'number', minimum: 0, maximum: 100000000000 },
            txSignature: { type: 'string', minLength: 1 },
            betPda: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  userId: { type: 'string' },
                  roundId: { type: 'string' },
                  selection: { type: 'object' },
                  stake: { type: 'number' },
                  odds: { type: 'number' },
                  status: { type: 'string' },
                  txHash: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    betsController.confirmBet
  );

  fastify.get(
    '/my-bets',
    {
      schema: {
        tags: ['Bets'],
        summary: 'Get user bets',
        description: 'Retrieve current user\'s betting history',
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['PENDING', 'WON', 'LOST', 'REFUNDED'] },
            marketId: { type: 'string' },
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    betsController.getUserBets
  );

  fastify.get(
    '/stats',
    {
      schema: {
        tags: ['Bets'],
        summary: 'Get betting statistics',
        description: 'Get user betting statistics and performance metrics',
      },
    },
    betsController.getBetStats
  );

  fastify.get(
    '/leaderboard',
    {
      schema: {
        tags: ['Bets'],
        summary: 'Get leaderboard',
        description: 'Get top performers leaderboard',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    betsController.getLeaderboard
  );

  fastify.get(
    '/round/:roundId',
    {
      schema: {
        tags: ['Bets'],
        summary: 'Get round bets',
        description: 'Get all bets for a specific round',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    betsController.getRoundBets
  );

  // Admin route for refunds
  fastify.post(
    '/round/:roundId/refund',
    {
      schema: {
        tags: ['Bets (Admin)'],
        summary: 'Refund round bets',
        description: 'Refund all pending bets for a round (admin only)',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
      },
    },
    betsController.refundBets
  );
}
