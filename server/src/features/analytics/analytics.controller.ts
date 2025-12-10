import { FastifyRequest, FastifyReply } from 'fastify';
import { AnalyticsService } from './analytics.service';
import { success } from '@/utils/response';
import { asyncHandler } from '@/utils/errors';

const analyticsService = new AnalyticsService();

export class AnalyticsController {
  getOverview = asyncHandler(async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await analyticsService.getOverview();
    return success(reply, data);
  });

  getMarketMetrics = asyncHandler(async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await analyticsService.getMarketMetrics();
    return success(reply, data);
  });

  getUserMetrics = asyncHandler(async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await analyticsService.getUserMetrics();
    return success(reply, data);
  });

  getTimeSeries = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { days = 14, granularity = 'daily' } = (request.query as any) || {};
    const d = Number(days) || 14;
    const g = (granularity === 'weekly' ? 'weekly' : 'daily') as 'daily' | 'weekly';
    const data = await analyticsService.getTimeSeries(d, g);
    return success(reply, data);
  });

  getMarketHealth = asyncHandler(async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await analyticsService.getMarketHealth();
    return success(reply, data);
  });

  getTrendingMarkets = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit = 10 } = (request.query as any) || {};
    const data = await analyticsService.getTrendingMarkets(Number(limit));
    return success(reply, data);
  });

  getRoundPerformanceMetrics = asyncHandler(async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await analyticsService.getRoundPerformanceMetrics();
    return success(reply, data);
  });
}

