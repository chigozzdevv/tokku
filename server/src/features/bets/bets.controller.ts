import { FastifyRequest, FastifyReply } from 'fastify';
import { BetsService } from './bets.service';
import { LeaderboardEntry } from '@/config/database';
import { success, paginated } from '@/utils/response';
import { asyncHandler } from '@/utils/errors';
import { requireAuth } from '@/features/auth';
import { logger } from '@/utils/logger';

const betsService = new BetsService();

export class BetsController {
  placeBet = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new Error('User not authenticated');
    }

    const { roundId, selection, stake } = request.body as {
      roundId: string;
      selection: any;
      stake: number;
    };

    const result = await betsService.createBetTransaction(
      request.user.id,
      request.user.walletAddress,
      roundId,
      selection,
      stake
    );

    return success(reply, result, 'Bet transaction created');
  });

  confirmBet = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new Error('User not authenticated');
    }

    const { roundId, selection, stake, txSignature, betPda } = request.body as {
      roundId: string;
      selection: any;
      stake: number;
      txSignature: string;
      betPda: string;
    };

    logger.info({ userId: request.user.id, roundId, txSignature, betPda }, 'Confirm bet request');

    const bet = await betsService.confirmBet(
      request.user.id,
      roundId,
      selection,
      stake,
      txSignature,
      betPda
    );

    return success(reply, bet, 'Bet confirmed');
  });

  getUserBets = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new Error('User not authenticated');
    }

    const options = request.query as any;
    const result = await betsService.getUserBets(request.user.id, options);

    return paginated(reply, result.items, result.total, result.page, result.limit);
  });

  getRoundBets = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { roundId } = (request.params as any);
    const userId = request.user?.id;
    
    const bets = await betsService.getRoundBets(roundId, userId);
    
    return success(reply, bets);
  });

  getBetStats = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user?.id;
    const { marketId } = request.query as any;
    
    const stats = await betsService.getBetStats(userId, marketId);
    
    return success(reply, stats);
  });

  refundBets = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { roundId } = (request.params as any);
    const { reason = 'Round settlement failed' } = request.body as any;
    
    const refunds = await betsService.refundBets(roundId, reason);
    
    return success(reply, refunds, `Refunded ${refunds.length} bets`);
  });

  getLeaderboard = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number };
    
    const [entries, total] = await Promise.all([
      LeaderboardEntry.find({})
        .populate({ path: 'userId', select: 'id walletAddress', model: 'User' })
        .sort({ totalPayout: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      LeaderboardEntry.countDocuments(),
    ]);

    const items = entries.map((entry: any, index: number) => ({
      id: String(entry._id ?? entry.id),
      user: entry.userId,
      totalBets: entry.totalBets,
      totalWon: entry.totalWon,
      totalStake: Number(entry.totalStake),
      totalPayout: Number(entry.totalPayout),
      winRate: entry.winRate,
      streak: entry.streak,
      updatedAt: entry.updatedAt,
      rank: (page - 1) * limit + index + 1,
    }));

    return paginated(reply, items, total, page, limit);
  });
}
