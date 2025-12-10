import { FastifyRequest, FastifyReply } from 'fastify';
import { CommunityService } from './community.service';

import { success, paginated } from '@/utils/response';
import { asyncHandler } from '@/utils/errors';

const communityService = new CommunityService();

export class CommunityController {
  joinCommunityRound = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new Error('User not authenticated');
    }

    const { roundId, byte } = request.body as any;
    
    const participation = await communityService.joinCommunityRound(
      request.user.id,
      roundId,
      byte
    );
    
    return success(reply, participation, 'Joined community round successfully');
  });

  getCommunityRoundParticipants = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { roundId } = request.params as any;
    
    const participants = await communityService.getCommunityRoundParticipants(roundId);
    
    return success(reply, participants);
  });

  getUserCommunityHistory = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new Error('User not authenticated');
    }

    const options = request.query as any;
    
    const history = await communityService.getUserCommunityHistory(request.user.id, options);
    
    return paginated(reply, history.items, history.total, history.page, history.limit);
  });

  getCommunityStats = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user?.id;
    
    const stats = await communityService.getCommunityStats(userId);
    
    return success(reply, stats);
  });

  getCommunityLeaderboard = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit = 50 } = request.query as any;
    
    const leaderboard = await communityService.getCommunityLeaderboard(limit);
    
    return success(reply, leaderboard);
  });

  finalizeCommunityRound = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { roundId } = request.params as any;
    
    const result = await communityService.finalizeCommunityRound(roundId);
    
    return success(reply, result, 'Community round finalized successfully');
  });

  getRealTimeParticipants = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { roundId } = request.params as any;
    
    const participants = await communityService.getCachedCommunityRound(roundId);
    
    return success(reply, participants);
  });
}
