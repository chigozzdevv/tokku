import { FastifyInstance } from 'fastify';
import { MarketsController } from './markets.controller';
import { requireAuth } from '@/features/auth';

const marketsController = new MarketsController();

export async function marketsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['Markets'],
        summary: 'Get all markets',
        description: 'Retrieve all active betting markets',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    type: { type: 'string' },
                    isActive: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
    marketsController.getAllMarkets
  );

  fastify.get(
    '/active',
    {
      schema: {
        tags: ['Markets'],
        summary: 'Get active rounds',
        description: 'Retrieve all currently active rounds across markets',
      },
    },
    marketsController.getActiveRounds
  );

  fastify.get(
    '/:marketId',
    {
      schema: {
        tags: ['Markets'],
        summary: 'Get market by ID',
        description: 'Retrieve specific market details and recent rounds',
        params: {
          type: 'object',
          required: ['marketId'],
          properties: {
            marketId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    marketsController.getMarketById
  );

  fastify.get(
    '/:marketId/history',
    {
      schema: {
        tags: ['Markets'],
        summary: 'Get market history',
        description: 'Retrieve historical rounds for a specific market',
        params: {
          type: 'object',
          required: ['marketId'],
          properties: {
            marketId: { type: 'string', minLength: 1 },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    marketsController.getMarketHistory
  );

  fastify.patch(
    '/:marketId/house-edge',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Markets'],
        summary: 'Update house edge (bps)',
        description: 'Admin: update on-chain market house_edge_bps and mirror to DB config',
        params: {
          type: 'object',
          required: ['marketId'],
          properties: { marketId: { type: 'string', minLength: 1 } },
        },
        body: {
          type: 'object',
          required: ['houseEdgeBps'],
          properties: {
            houseEdgeBps: { type: 'number', minimum: 0, maximum: 10000 },
          },
        },
      },
    },
    marketsController.updateHouseEdge
  );

  fastify.patch(
    '/house-edge/by-type',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Markets'],
        summary: 'Bulk update house edge (bps) by type',
        body: {
          type: 'object',
          required: ['type', 'houseEdgeBps'],
          properties: {
            type: { type: 'string' },
            houseEdgeBps: { type: 'number', minimum: 0, maximum: 10000 },
          },
        },
      },
    },
    marketsController.updateHouseEdgeByType
  );
}
