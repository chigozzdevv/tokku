import { Round, CommunitySeed, User } from '@/config/database';
import { redis } from '@/config/redis';
import { RoundStatus } from '@/shared/types';
import { NotFoundError, ValidationError, ConflictError } from '@/shared/errors';
import { TeeService } from '@/solana/tee-service';
import { logger } from '@/utils/logger';

const teeService = new TeeService();

export class CommunityService {
  async joinCommunityRound(userId: string, roundId: string, byte: number) {
    if (byte < 0 || byte > 255) {
      throw new ValidationError('Byte must be between 0 and 255');
    }

    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();

    if (!round) {
      throw new NotFoundError('Round');
    }

    if (round.status !== RoundStatus.PREDICTING) {
      throw new ConflictError('Round is no longer accepting community seeds');
    }

    const existingSeed = await CommunitySeed.findOne({ userId, roundId }).lean();

    if (existingSeed) {
      throw new ConflictError('User already joined this community round');
    }

    const communitySeed = await CommunitySeed.create({ userId, roundId, byte });

    await redis.hset(
      redisKeys.communityRound(roundId),
      userId,
      JSON.stringify({
        byte,
        joinedAt: communitySeed.createdAt,
      })
    );

    await redis.incr(redisKeys.communityCount(roundId));

    logger.info(`User joined community round: ${userId} - Round: ${roundId} - Byte: ${byte}`);

    return communitySeed;
  }

  async finalizeCommunityRound(roundId: string) {
    const seeds = await CommunitySeed.find({ roundId }).sort({ createdAt: 1 }).lean();

    if (seeds.length === 0) {
      throw new ValidationError('No community seeds found for this round');
    }

    const seedBytes = seeds.map((seed: { byte: number }) => seed.byte);

    const teeAttestation = await teeService.generateOutcome(
      roundId,
      'CommunitySeed',
      { communitySeeds: seedBytes }
    );

    const { final_byte: finalByte, seed_hash } = teeAttestation.outcome;
    const finalHash = Buffer.from(seed_hash).toString('hex');

    const seededWithDistance = await Promise.all(
      seeds.map(async (seed: any) => {
        const distance = this.calculateHammingDistance(seed.byte, finalByte);

        await CommunitySeed.updateOne({ _id: seed._id }, { $set: { distance, won: distance === 0 } });

        return {
          ...seed,
          distance,
          won: distance === 0,
        };
      })
    );

    const winners = seededWithDistance.filter((seed: { won?: boolean }) => seed.won);

    const closestWinners = winners.length > 0 ? winners :
      seededWithDistance
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
        .slice(0, 1);

    const result = {
      type: 'community',
      finalByte,
      finalHash,
      participants: seeds.length,
      winners: closestWinners.map(w => ({
        userId: w.userId,
        byte: w.byte,
        distance: w.distance,
      })),
    };

    return {
      ...result,
      seedBytes,
      seededWithDistance,
    };
  }

  private calculateHammingDistance(byte1: number, byte2: number): number {
    // Calculate Hamming distance between two bytes (8-bit)
    let xor = byte1 ^ byte2;
    let distance = 0;
    
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
    
    return distance;
  }

  async getCommunityRoundParticipants(roundId: string) {
    const seeds = await CommunitySeed.find({ roundId })
      .populate({ path: 'userId', select: 'id walletAddress', model: 'User' })
      .sort({ createdAt: 1 })
      .lean();

    const total = seeds.length;
    const minByte = Math.min(...seeds.map((s: { byte: number }) => s.byte));
    const maxByte = Math.max(...seeds.map((s: { byte: number }) => s.byte));
    const avgByte = seeds.reduce((sum: number, s: { byte: number }) => sum + s.byte, 0) / total;

    return {
      participants: seeds,
      stats: {
        total,
        minByte,
        maxByte,
        avgByte: Math.round(avgByte * 100) / 100,
      },
    };
  }

  async getUserCommunityHistory(userId: string, options: any = {}) {
    const { page = 1, limit = 20 } = options;

    const [seeds, total] = await Promise.all([
      CommunitySeed.find({ userId })
        .populate({ path: 'roundId', select: 'roundNumber status settledAt marketId', populate: { path: 'marketId', select: 'name type' }, model: 'Round' })
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

  async getCommunityStats(userId?: string) {
    const userFilter = userId ? { userId } : {};

    const [ totalParticipations, totalWins, totalRounds, avg ] = await Promise.all([
      CommunitySeed.countDocuments(userFilter),
      CommunitySeed.countDocuments({ ...userFilter, won: true }),
      Round.countDocuments({ status: RoundStatus.SETTLED }),
      CommunitySeed.aggregate([{ $match: { ...userFilter, distance: { $ne: null } } }, { $group: { _id: null, avg: { $avg: '$distance' } } }]),
    ]);

    const winRate = totalParticipations > 0 ? (totalWins / totalParticipations) * 100 : 0;

    return {
      totalParticipations,
      totalWins,
      totalRounds,
      winRate: Math.round(winRate * 100) / 100,
      avgDistance: avg?.[0]?.avg ? Math.round((avg?.[0]?.avg || 0) * 100) / 100 : 0,
    };
  }

  async getCommunityLeaderboard(limit: number = 50) {
    const winStats = await CommunitySeed.aggregate([
      { $match: { won: true } },
      { $group: { _id: '$userId', totalWins: { $sum: 1 } } },
      { $sort: { totalWins: -1 } },
      { $limit: limit },
    ]);

    const leaderboard = [] as any[];
    for (let i = 0; i < winStats.length; i++) {
      const stat = winStats[i];
      const user = await User.findById(stat._id).select('id walletAddress').lean();
      const totalParticipations = await CommunitySeed.countDocuments({ userId: stat._id });
      const winRate = totalParticipations > 0 ? (stat.totalWins / totalParticipations) * 100 : 0;
      leaderboard.push({ rank: i + 1, user: user!, totalWins: stat.totalWins, totalParticipations, winRate: Math.round(winRate * 100) / 100 });
    }

    return leaderboard;
  }

  async getCachedCommunityRound(roundId: string) {
    const cached = await redis.hgetall(redisKeys.communityRound(roundId));
    
    if (Object.keys(cached).length > 0) {
      const participants = Object.entries(cached).map(([userId, data]) => ({
        userId,
        ...JSON.parse(data),
      }));

      return { participants };
    }

    const participants = await this.getCommunityRoundParticipants(roundId);
    
    const cacheData: any = {};
    participants.participants.forEach((p: any) => {
      cacheData[p.userId] = JSON.stringify({
        byte: p.byte,
        joinedAt: p.createdAt,
      });
    });
    
    await redis.hmset(redisKeys.communityRound(roundId), cacheData);

    return participants;
  }
}

const redisKeys = {
  communityRound: (roundId: string) => `community:${roundId}`,
  communityCount: (roundId: string) => `community:${roundId}:count`,
};
