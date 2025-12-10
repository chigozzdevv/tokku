import { Bet, User, Round, Attestation, Market } from '@/config/database';

type Granularity = 'daily' | 'weekly';

export class AnalyticsService {
  async getOverview() {
    const [
      totalBets,
      wonBets,
      pendingBets,
      stakeAgg,
      payoutAgg,
      usersTotal,
      roundsSettled,
      attestationsTotal,
      attestationsVerified,
    ] = await Promise.all([
      Bet.countDocuments(),
      Bet.countDocuments({ status: 'WON' }),
      Bet.countDocuments({ status: 'PENDING' }),
      Bet.aggregate([{ $group: { _id: null, total: { $sum: '$stake' } } }]),
      Bet.aggregate([{ $match: { status: 'WON' } }, { $group: { _id: null, total: { $sum: '$payout' } } }]),
      User.countDocuments(),
      Round.countDocuments({ status: 'SETTLED' }),
      Attestation.countDocuments(),
      Attestation.countDocuments({ verified: true }),
    ]);

    const roundsForTiming = await Round.find({ lockedAt: { $ne: null }, revealedAt: { $ne: null }, settledAt: { $ne: null } })
      .select('lockedAt revealedAt settledAt')
      .limit(5000)
      .lean();
    let lockToRevealMs = 0;
    let revealToSettleMs = 0;
    if (roundsForTiming.length > 0) {
      for (const r of roundsForTiming) {
        lockToRevealMs += r.revealedAt!.getTime() - r.lockedAt!.getTime();
        revealToSettleMs += r.settledAt!.getTime() - r.revealedAt!.getTime();
      }
      lockToRevealMs = Math.round(lockToRevealMs / roundsForTiming.length);
      revealToSettleMs = Math.round(revealToSettleMs / roundsForTiming.length);
    }

    const totalStaked = Number((stakeAgg[0]?.total) || 0);
    const totalPaid = Number((payoutAgg[0]?.total) || 0);
    const profitLoss = totalPaid - totalStaked;
    const winRate = totalBets > 0 ? (wonBets / totalBets) * 100 : 0;
    const verificationRate = attestationsTotal > 0 ? (attestationsVerified / attestationsTotal) * 100 : 0;

    return {
      totals: {
        users: usersTotal,
        bets: totalBets,
        roundsSettled,
        pendingBets,
      },
      finance: {
        totalStaked,
        totalPaid,
        profitLoss,
        winRate: Math.round(winRate * 100) / 100,
      },
      attestations: {
        total: attestationsTotal,
        verified: attestationsVerified,
        verificationRate: Math.round(verificationRate * 100) / 100,
      },
      timings: {
        avgLockToRevealMs: lockToRevealMs,
        avgRevealToSettleMs: revealToSettleMs,
      },
    };
  }

  async getMarketMetrics() {
    const markets = await Market.find({}).select('name type').lean();
    const perMarketBets = await Bet.aggregate([
      { $group: { _id: '$marketId', totalBets: { $sum: 1 }, totalStake: { $sum: '$stake' }, totalPayout: { $sum: '$payout' } } }
    ]);
    const perMarketRounds = await Round.aggregate([{ $group: { _id: '$marketId', count: { $sum: 1 } } }]);
    const roundsSettledByMarket = await Round.aggregate([{ $match: { status: 'SETTLED' } }, { $group: { _id: '$marketId', count: { $sum: 1 } } }]);

    const roundsByMarketMap = new Map(perMarketRounds.map((r: any) => [String(r._id), r.count]));
    const settledByMarketMap = new Map(roundsSettledByMarket.map((r: any) => [String(r._id), r.count]));

    const result = markets.map((m: any) => {
      const b = perMarketBets.find((x: any) => String(x._id) === String(m._id));
      const totalStake = Number(b?.totalStake || 0);
      const totalPayout = Number(b?.totalPayout || 0);
      const totalBets = b?.totalBets || 0;
      const totalRounds = roundsByMarketMap.get(String(m._id)) || 0;
      const settledRounds = settledByMarketMap.get(String(m._id)) || 0;
      const avgBetsPerRound = Number(totalRounds) > 0 ? Math.round((Number(totalBets) / Number(totalRounds)) * 100) / 100 : 0;
      const profitLoss = totalPayout - totalStake;
      return {
        marketId: m.id,
        name: m.name,
        type: m.type,
        totals: {
          rounds: totalRounds,
          settledRounds,
          bets: totalBets,
        },
        finance: {
          totalStake,
          totalPayout,
          profitLoss,
        },
        ratios: {
          avgBetsPerRound,
        },
      };
    });

    return result;
  }

  async getUserMetrics() {
    const now = new Date();
    const d1 = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [dau, wau, mau] = await Promise.all([
      this.countActiveUsersSince(d1),
      this.countActiveUsersSince(d7),
      this.countActiveUsersSince(d30),
    ]);

    return { dau, wau, mau };
  }

  async getTimeSeries(days: number = 14, granularity: Granularity = 'daily') {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const bets = await Bet.find({ createdAt: { $gte: since } }).select('createdAt stake payout').sort({ createdAt: 1 }).lean();

    const byKey = new Map<string, { date: string; bets: number; volume: number; payout: number }>();
    const toKey = (d: Date) => {
      if (granularity === 'weekly') {
        // ISO week key: YYYY-WW
        const wd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const dayNum = wd.getUTCDay() || 7;
        wd.setUTCDate(wd.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(wd.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((wd.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        return `${wd.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      }
      return d.toISOString().slice(0, 10);
    };

    for (const b of bets) {
      const key = toKey(b.createdAt);
      const entry = byKey.get(key) || { date: key, bets: 0, volume: 0, payout: 0 };
      entry.bets += 1;
      entry.volume += Number(b.stake);
      entry.payout += Number(b.payout || 0);
      byKey.set(key, entry);
    }

    return Array.from(byKey.values());
  }

  private async countActiveUsersSince(since: Date) {
    const distinct = await Bet.distinct('userId', { createdAt: { $gte: since } });
    return distinct.length;
  }

  async getMarketHealth() {
    const markets = await Market.find({}).select('_id name type isActive').lean();

    const marketHealth = await Promise.all(
      markets.map(async (market: any) => {
        const marketId = String(market._id);

        const [activeRounds, totalRounds, settledRounds, recentBets] = await Promise.all([
          Round.countDocuments({ marketId: market._id, status: 'PREDICTING' }),
          Round.countDocuments({ marketId: market._id }),
          Round.countDocuments({ marketId: market._id, status: 'SETTLED' }),
          Bet.find({ marketId: market._id }).select('stake createdAt').lean()
        ]);

        const totalBets = recentBets.length;
        const avgBetsPerRound = totalRounds > 0 ? totalBets / totalRounds : 0;

        const now = Date.now();
        const last24h = new Date(now - 24 * 60 * 60 * 1000);
        const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

        const bets24h = recentBets.filter(b => b.createdAt >= last24h);
        const bets7d = recentBets.filter(b => b.createdAt >= last7d);

        const volume24h = bets24h.reduce((sum, bet) => sum + Number(bet.stake), 0);
        const volume7d = bets7d.reduce((sum, bet) => sum + Number(bet.stake), 0);

        const avgVolume7dPerDay = volume7d / 7;
        const volumeGrowth = avgVolume7dPerDay > 0 ? ((volume24h - avgVolume7dPerDay) / avgVolume7dPerDay) * 100 : 0;

        const settlementRate = totalRounds > 0 ? (settledRounds / totalRounds) * 100 : 0;

        return {
          marketId,
          name: market.name,
          type: market.type,
          isActive: market.isActive,
          activeRounds,
          totalRounds,
          avgBetsPerRound: Math.round(avgBetsPerRound * 100) / 100,
          volume24h,
          volumeGrowth: Math.round(volumeGrowth * 100) / 100,
          settlementRate: Math.round(settlementRate * 100) / 100,
          totalBets
        };
      })
    );

    return marketHealth;
  }

  async getTrendingMarkets(limit: number = 10) {
    const markets = await Market.find({}).select('_id name type').lean();

    const now = Date.now();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);
    const last48h = new Date(now - 48 * 60 * 60 * 1000);

    const marketStats = await Promise.all(
      markets.map(async (market: any) => {
        const marketId = String(market._id);

        const [bets24h, bets48h, activeRounds] = await Promise.all([
          Bet.find({ marketId: market._id, createdAt: { $gte: last24h } }).select('stake').lean(),
          Bet.find({ marketId: market._id, createdAt: { $gte: last48h, $lt: last24h } }).select('stake').lean(),
          Round.countDocuments({ marketId: market._id, status: 'PREDICTING' })
        ]);

        const volume24h = bets24h.reduce((sum, bet) => sum + Number(bet.stake), 0);
        const volumePrevious24h = bets48h.reduce((sum, bet) => sum + Number(bet.stake), 0);

        const volumeChange = volumePrevious24h > 0
          ? ((volume24h - volumePrevious24h) / volumePrevious24h) * 100
          : volume24h > 0 ? 100 : 0;

        return {
          marketId,
          name: market.name,
          type: market.type,
          volume24h,
          volumeChange: Math.round(volumeChange * 100) / 100,
          activeRounds,
          bets24h: bets24h.length
        };
      })
    );

    return marketStats
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, limit);
  }

  async getRoundPerformanceMetrics() {
    const rounds = await Round.find({ status: 'SETTLED' })
      .select('openedAt lockedAt revealedAt settledAt marketId')
      .lean();

    if (rounds.length === 0) {
      return {
        avgDuration: 0,
        avgLockToReveal: 0,
        avgRevealToSettle: 0,
        totalSettled: 0
      };
    }

    let totalDuration = 0;
    let totalLockToReveal = 0;
    let totalRevealToSettle = 0;
    let validRounds = 0;

    rounds.forEach((r: any) => {
      if (r.openedAt && r.lockedAt && r.revealedAt && r.settledAt) {
        totalDuration += new Date(r.settledAt).getTime() - new Date(r.openedAt).getTime();
        totalLockToReveal += new Date(r.revealedAt).getTime() - new Date(r.lockedAt).getTime();
        totalRevealToSettle += new Date(r.settledAt).getTime() - new Date(r.revealedAt).getTime();
        validRounds++;
      }
    });

    return {
      avgDuration: validRounds > 0 ? Math.round(totalDuration / validRounds) : 0,
      avgLockToReveal: validRounds > 0 ? Math.round(totalLockToReveal / validRounds) : 0,
      avgRevealToSettle: validRounds > 0 ? Math.round(totalRevealToSettle / validRounds) : 0,
      totalSettled: rounds.length
    };
  }
}
