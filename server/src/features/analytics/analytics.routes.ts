import { FastifyInstance } from 'fastify';
import { AnalyticsController } from './analytics.controller';

const controller = new AnalyticsController();

export async function analyticsRoutes(fastify: FastifyInstance) {

  fastify.get(
    '/overview',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Platform overview metrics',
        description: 'High-level KPIs: bets, users, finances, timings, attestations',
      },
    },
    controller.getOverview
  );

  fastify.get(
    '/markets',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Per-market performance metrics',
        description: 'Rounds, bets, volume, payout, PnL per market',
      },
    },
    controller.getMarketMetrics
  );

  fastify.get(
    '/users',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'User activity metrics',
        description: 'DAU/WAU/MAU based on betting activity',
      },
    },
    controller.getUserMetrics
  );

  fastify.get(
    '/timeseries',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Timeseries of bets/volume/payout',
        description: 'Aggregated by day or week',
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'number', minimum: 1, maximum: 180, default: 14 },
            granularity: { type: 'string', enum: ['daily', 'weekly'], default: 'daily' },
          },
        },
      },
    },
    controller.getTimeSeries
  );

  fastify.get(
    '/market-health',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Market health metrics',
        description: 'Health indicators for all markets: active rounds, volume growth, settlement rate',
      },
    },
    controller.getMarketHealth
  );

  fastify.get(
    '/trending-markets',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Trending markets',
        description: 'Markets sorted by 24h volume with growth metrics',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number', minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
    },
    controller.getTrendingMarkets
  );

  fastify.get(
    '/round-performance',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Round performance metrics',
        description: 'Average round duration and lifecycle timings',
      },
    },
    controller.getRoundPerformanceMetrics
  );
}

