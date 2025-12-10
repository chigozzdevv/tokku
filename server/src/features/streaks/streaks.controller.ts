import { FastifyRequest, FastifyReply } from 'fastify';
import { StreaksService } from './streaks.service';

import { success, paginated } from '@/utils/response';
import { asyncHandler } from '@/utils/errors';
import { requireAuth } from '@/features/auth';

const streaksService = new StreaksService();

export class StreaksController {
  createStreak = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new Error('User not authenticated');
    }

    const { marketId, target } = request.body as any;
    
    const streak = await streaksService.createStreak(request.user.id, marketId, target);
    
    return success(reply, streak, 'Streak started successfully');
  });

  getUserStreaks = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new Error('User not authenticated');
    }

    const { status } = request.query as any;
    
    const streaks = await streaksService.getUserStreaks(request.user.id, status);
    
    return success(reply, streaks);
  });

  getActiveStreak = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new Error('User not authenticated');
    }

    const { marketId } = request.query as any;
    
    const streak = await streaksService.getActiveStreak(request.user.id, marketId);
    
    return success(reply, streak);
  });

  getStreakLeaderboard = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit = 50 } = request.query as any;
    
    const leaderboard = await streaksService.getStreakLeaderboard(limit);
    
    return success(reply, leaderboard);
  });

  getStreakOdds = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.query as any;
    
    if (!target || target < 2 || target > 5) {
      throw new Error('Invalid streak target. Must be between 2 and 5');
    }
    
    const odds = await streaksService.getStreakOdds(target);
    
    return success(reply, { target, odds });
  });

  getStreakStats = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user?.id;
    
    const stats = await streaksService.getStreakStats(userId);
    
    return success(reply, stats);
  });

  validateStreakBet = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new Error('User not authenticated');
    }

    const { target, stake } = request.body as any;
    
    const valid = await streaksService.validateStreakBet(request.user.id, target, stake);
    
    return success(reply, { valid, message: 'Streak bet is valid' });
  });
}
