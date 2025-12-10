import { User, Bet, Streak, CommunitySeed, LeaderboardEntry } from '@/config/database';
import { NotFoundError } from '@/shared/errors';

export class UserService {
  async getProfile(userId: string) {
    const user = await User.findById(userId).lean();

    if (!user) {
      throw new NotFoundError('User');
    }

    const [stats, leaderboard] = await Promise.all([
      this.getUserStats(userId),
      LeaderboardEntry.findOne({ userId }).lean(),
    ]);

    return {
      id: user.id,
      walletAddress: user.walletAddress,
      createdAt: user.createdAt,
      stats: {
        totalBets: await Bet.countDocuments({ userId }),
        totalStreaks: await Streak.countDocuments({ userId }),
        totalCommunityParticipations: await CommunitySeed.countDocuments({ userId }),
        ...stats,
      },
      leaderboard: leaderboard ? {
        totalWon: leaderboard.totalWon,
        winRate: leaderboard.winRate,
        streak: leaderboard.streak,
        totalPayout: Number(leaderboard.totalPayout),
      } : null,
    };
  }

  async getUserStats(userId: string) {
    const [
      wonBets,
      totalStake,
      totalPayout,
      activeStreaks,
      completedStreaks,
      communityWins,
    ] = await Promise.all([
      Bet.countDocuments({ userId, status: 'WON' }),
      Bet.aggregate([{ $match: { userId } }, { $group: { _id: null, total: { $sum: '$stake' } } }]),
      Bet.aggregate([{ $match: { userId, status: 'WON' } }, { $group: { _id: null, total: { $sum: '$payout' } } }]),
      Streak.countDocuments({ userId, status: 'ACTIVE' }),
      Streak.countDocuments({ userId, status: 'COMPLETED' }),
      CommunitySeed.countDocuments({ userId, won: true }),
    ]);

    const totalStaked = Number((totalStake[0]?.total) || 0);
    const totalPaid = Number((totalPayout[0]?.total) || 0);
    const profitLoss = totalPaid - totalStaked;

    return {
      wonBets,
      totalStaked,
      totalPaid,
      profitLoss,
      activeStreaks,
      completedStreaks,
      communityWins,
    };
  }

  async getBetHistory(userId: string, options: { page?: number; limit?: number; marketId?: string } = {}) {
    const { page = 1, limit = 20, marketId } = options;

    const where: any = { userId };
    if (marketId) where.marketId = marketId;

    const [bets, total] = await Promise.all([
      Bet.find(where)
        .populate({
          path: 'roundId',
          select: 'roundNumber status outcome settledAt marketId',
          populate: { path: 'marketId', select: 'id name type' },
          model: 'Round',
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Bet.countDocuments(where),
    ]);

    return {
      items: bets.map((bet: any) => ({
        id: bet._id?.toString() || bet.id,
        selection: bet.selection,
        stake: Number(bet.stake),
        odds: bet.odds,
        status: bet.status,
        payout: bet.payout != null ? Number(bet.payout) : null,
        createdAt: bet.createdAt,
        round: bet.roundId,
      })),
      total,
      page,
      limit,
      hasNext: page * limit < total,
      hasPrev: page > 1,
    };
  }

  async getStreakHistory(userId: string, options: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = options;

    const [streaks, total] = await Promise.all([
      Streak.find({ userId })
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Streak.countDocuments({ userId }),
    ]);

    return {
      items: streaks,
      total,
      page,
      limit,
      hasNext: page * limit < total,
      hasPrev: page > 1,
    };
  }

  async getCommunityHistory(userId: string, options: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = options;

    const [seeds, total] = await Promise.all([
      CommunitySeed.find({ userId })
        .populate({
          path: 'roundId',
          select: 'roundNumber status settledAt marketId',
          populate: { path: 'marketId', select: 'name type' },
          model: 'Round',
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CommunitySeed.countDocuments({ userId }),
    ]);

    return {
      items: seeds,
      total,
      page,
      limit,
      hasNext: page * limit < total,
      hasPrev: page > 1,
    };
  }

  async getRecentActivity(userId: string, limit: number = 10) {
    const [recentBets, recentStreaks, recentCommunity] = await Promise.all([
      Bet.find({ userId })
        .populate({ path: 'roundId', select: 'roundNumber marketId', populate: { path: 'marketId', select: 'name' }, model: 'Round' })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Streak.find({ userId })
        .sort({ startedAt: -1 })
        .limit(limit)
        .lean(),
      CommunitySeed.find({ userId })
        .populate({ path: 'roundId', select: 'roundNumber marketId', populate: { path: 'marketId', select: 'name' }, model: 'Round' })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    return {
      recentBets: recentBets.map((bet: any) => ({
        type: 'bet',
        id: bet._id?.toString() || bet.id,
        stake: Number(bet.stake),
        status: bet.status,
        market: bet.roundId?.marketId?.name,
        roundNumber: bet.roundId?.roundNumber,
        createdAt: bet.createdAt,
      })),
      recentStreaks: recentStreaks.map((streak: any) => ({
        type: 'streak',
        id: streak._id?.toString() || streak.id,
        currentStreak: streak.currentStreak,
        target: streak.target,
        status: streak.status,
        startedAt: streak.startedAt,
      })),
      recentCommunity: recentCommunity.map((seed: any) => ({
        type: 'community',
        id: seed._id?.toString() || seed.id,
        byte: seed.byte,
        won: seed.won,
        distance: seed.distance,
        market: seed.roundId?.marketId?.name,
        roundNumber: seed.roundId?.roundNumber,
        createdAt: seed.createdAt,
      })),
    };
  }
}
