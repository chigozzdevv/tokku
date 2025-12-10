import { Streak } from '@/config/database';
import { redis } from '@/config/redis';
import { StreakStatus, MarketType } from '@/shared/types';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

export class StreaksService {
  async createStreak(userId: string, marketId?: string, target?: number) {
    const streakTarget = target || Math.min(3, config.MAX_STREAK_TARGET);
    
    const existingStreak = await Streak.findOne({ userId, marketId: marketId || null, status: StreakStatus.ACTIVE }).lean();

    if (existingStreak) {
      throw new ConflictError('User already has an active streak');
    }

    const streak = await Streak.create({ userId, marketId, target: streakTarget, status: StreakStatus.ACTIVE });

    // Cache active streak
    await redis.hset(
      redisKeys.activeStreaks,
      `${userId}-${marketId || 'global'}`,
      JSON.stringify(streak)
    );

    logger.info(`Streak created: ${streak.id} - User: ${userId} - Target: ${streakTarget}`);

    return streak;
  }

  async updateStreakProgress(userId: string, roundResult: 'won' | 'lost', roundId: string) {
    const activeStreaks = await Streak.find({ userId, status: StreakStatus.ACTIVE }).lean();

    const updatedStreaks = [];

    for (const streak of activeStreaks) {
      if (roundResult === 'won') {
        // Increment streak
        const newStreakCount = streak.currentStreak + 1;
        
        if (newStreakCount >= streak.target) {
          // Streak completed!
          await Streak.updateOne({ _id: (streak as any)._id }, { $set: { currentStreak: newStreakCount, status: StreakStatus.COMPLETED, completedAt: new Date(), lastRoundId: roundId } });
          const completedStreak = await Streak.findById((streak as any)._id).lean();
          
          updatedStreaks.push({ ...completedStreak, result: 'completed' });
          
          logger.info(`Streak completed: ${streak.id} - User: ${userId} - Final count: ${newStreakCount}`);
        } else {
          // Continue streak
          await Streak.updateOne({ _id: (streak as any)._id }, { $set: { currentStreak: newStreakCount, lastRoundId: roundId } });
          const updatedStreak = await Streak.findById((streak as any)._id).lean();
          
          updatedStreaks.push({ ...updatedStreak, result: 'progress' });
        }
      } else {
        // Reset streaks (lost)
        await Streak.updateOne({ _id: (streak as any)._id }, { $set: { status: StreakStatus.FAILED, lastRoundId: roundId } });
        const resetStreak = await Streak.findById((streak as any)._id).lean();
        
        updatedStreaks.push({ ...resetStreak, result: 'failed' });
        
        logger.info(`Streak failed: ${streak.id} - User: ${userId} - Final count: ${streak.currentStreak}`);
      }

      // Update cache
      await redis.hdel(redisKeys.activeStreaks, `${userId}-${streak.marketId || 'global'}`);
    }

    return updatedStreaks;
  }

  async getUserStreaks(userId: string, status?: StreakStatus) {
    const where: any = { userId };
    if (status) where.status = status;

    const streaks = await Streak.find(where)
      .populate({ path: 'userId', select: 'id walletAddress', model: 'User' })
      .sort({ startedAt: -1 })
      .lean();

    return streaks;
  }

  async getActiveStreak(userId: string, marketId?: string) {
    const streak = await Streak.findOne({ userId, marketId: marketId || null, status: StreakStatus.ACTIVE }).lean();

    if (!streak) {
      throw new NotFoundError('Active streak');
    }

    return streak;
  }

  async getStreakLeaderboard(limit: number = 50) {
    const topStreaks = await Streak.find({ status: StreakStatus.COMPLETED })
      .populate({ path: 'userId', select: 'id walletAddress', model: 'User' })
      .sort({ target: -1, completedAt: -1 })
      .limit(limit)
      .lean();

    return topStreaks.map((streak: any, index: number) => ({
      ...streak,
      rank: index + 1,
      completionTime: streak.completedAt 
        ? new Date(streak.completedAt).getTime() - new Date(streak.startedAt).getTime()
        : 0,
    }));
  }

  async getStreakOdds(target: number): Promise<number> {
    // Calculate odds based on target difficulty
    const baseOdds = 2.0;
    const difficultyMultiplier = Math.pow(target, 1.5);
    
    return Math.min(baseOdds * difficultyMultiplier, 100); // Cap at 100x
  }

  async validateStreakBet(userId: string, target: number, stake: number): Promise<boolean> {
    // Check if user already has active streak
    const existingStreak = await Streak.findOne({ userId, status: StreakStatus.ACTIVE }).lean();

    if (existingStreak) {
      throw new ConflictError('User already has an active streak');
    }

    // Validate target
    if (target < 2 || target > config.MAX_STREAK_TARGET) {
      throw new ValidationError(`Streak target must be between 2 and ${config.MAX_STREAK_TARGET}`);
    }

    // Validate stake
    if (stake <= 0 || stake > 1000000) { // Max 1 SOL
      throw new ValidationError('Invalid stake amount');
    }

    return true;
  }

  async getStreakStats(userId?: string) {
    const where: any = {};
    if (userId) where.userId = userId;

    const [ totalStreaks, completedStreaks, failedStreaks, activeStreaks, bestStreak ] = await Promise.all([
      Streak.countDocuments(where),
      Streak.countDocuments({ ...where, status: StreakStatus.COMPLETED }),
      Streak.countDocuments({ ...where, status: StreakStatus.FAILED }),
      Streak.countDocuments({ ...where, status: StreakStatus.ACTIVE }),
      Streak.findOne({ ...where, status: StreakStatus.COMPLETED }).sort({ target: -1 }).lean(),
    ]);

    const completionRate = totalStreaks > 0 ? (completedStreaks / totalStreaks) * 100 : 0;

    return {
      totalStreaks,
      completedStreaks,
      failedStreaks,
      activeStreaks,
      completionRate: Math.round(completionRate * 100) / 100,
      bestTarget: bestStreak?.target || 0,
      bestCurrentStreak: bestStreak?.currentStreak || 0,
    };
  }

  async cleanupInactiveStreaks() {
    // This would be called by a background job
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 24); // 24 hours ago

    const res = await Streak.updateMany({ status: StreakStatus.ACTIVE, startedAt: { $lt: cutoffTime } }, { $set: { status: StreakStatus.FAILED } });
    const inactiveStreaks = { count: (res as any).modifiedCount ?? (res as any).matchedCount } as any;

    logger.info(`Cleaned up ${inactiveStreaks.count} inactive streaks`);

    return inactiveStreaks;
  }
}

const redisKeys = {
  activeStreaks: 'streaks:active',
};
