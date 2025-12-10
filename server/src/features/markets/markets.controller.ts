import { FastifyRequest, FastifyReply } from 'fastify';
import { MarketsService } from './markets.service';
import { success} from '@/utils/response';
import { asyncHandler } from '@/utils/errors';

const marketsService = new MarketsService();

export class MarketsController {
  getAllMarkets = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const markets = await marketsService.getAllMarkets();
    return success(reply, markets);
  });

  getMarketById = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { marketId } = request.params as { marketId: string };
    const market = await marketsService.getMarketById(marketId);
    return success(reply, market);
  });

  getActiveRounds = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const rounds = await marketsService.getActiveRounds();
    return success(reply, rounds);
  });

  getMarketHistory = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { marketId } = request.params as { marketId: string };
    const { limit = 50 } = request.query as { limit?: number };

    const history = await marketsService.getMarketHistory(marketId, limit);
    return success(reply, history);
  });

  updateHouseEdge = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { marketId } = request.params as { marketId: string };
    const { houseEdgeBps } = request.body as { houseEdgeBps: number };
    const result = await marketsService.updateHouseEdgeBps(marketId, houseEdgeBps, request.user!);
    return success(reply, result);
  });

  updateHouseEdgeByType = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { type, houseEdgeBps } = request.body as { type: string; houseEdgeBps: number };
    const result = await marketsService.updateHouseEdgeBpsByType(type, houseEdgeBps, request.user!);
    return success(reply, result);
  });
}
