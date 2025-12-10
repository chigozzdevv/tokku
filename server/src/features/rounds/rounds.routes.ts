import { FastifyInstance } from 'fastify';
import { RoundsController } from './rounds.controller';
import { requireAuth } from '@/features/auth';

const roundsController = new RoundsController();

export async function roundsRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/open',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Rounds'],
        summary: 'Open a new round',
        description: 'Create and delegate a new betting round to ER',
        body: {
          type: 'object',
          properties: {
            marketId: { type: 'string', minLength: 1 },
          },
          required: ['marketId'],
        },
      },
    },
    roundsController.openRound.bind(roundsController)
  );

  fastify.post(
    '/lock',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Rounds'],
        summary: 'Lock a round',
        description: 'Lock a round and trigger outcome generation',
        body: {
          type: 'object',
          properties: {
            roundId: { type: 'string', minLength: 1 },
          },
          required: ['roundId'],
        },
      },
    },
    roundsController.lockRound.bind(roundsController)
  );

  fastify.post(
    '/:roundId/undelegate',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Rounds'],
        summary: 'Undelegate round',
        description: 'Undelegate round from ER back to base layer',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    roundsController.undelegateRound.bind(roundsController)
  );

  fastify.get(
    '/:roundId',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Get round details',
        description: 'Retrieve specific round information',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    roundsController.getRound.bind(roundsController)
  );

  fastify.get(
    '/',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Get active rounds',
        description: 'Retrieve all active rounds',
        querystring: {
          type: 'object',
          properties: {
            marketId: { type: 'string' },
          },
        },
      },
    },
    roundsController.getActiveRounds.bind(roundsController)
  );

  fastify.get(
    '/:roundId/analytics',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Get round analytics',
        description: 'Get detailed analytics for a specific round including volume, bets, timeline, and trends',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    roundsController.getRoundAnalytics.bind(roundsController)
  );

  fastify.get(
    '/:roundId/probability-history',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Get probability history',
        description: 'Get historical probability distribution for all selections in a round over time',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    roundsController.getProbabilityHistory.bind(roundsController)
  );
}
