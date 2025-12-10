import { Market, Round, Bet } from '@/config/database';
import { MarketType } from '@/shared/types';
import { AuthenticationError, NotFoundError, ValidationError } from '@/shared/errors';
import { TokkuProgramService } from '@/solana/tokku-program-service';
import { getAdminKeypair } from '@/config/admin-keypair';
import { getMarketConfig } from '@/utils/market-config';
import { PublicKey } from '@solana/web3.js';

const tokkuProgram = new TokkuProgramService();

export class MarketsService {
  async getAllMarkets() {
    const markets = await Market.find({ isActive: true }).sort({ name: 1 }).lean();
    const marketIds = markets.map(m => m._id);
    const [roundCounts, betCounts] = await Promise.all([
      Round.aggregate([{ $match: { marketId: { $in: marketIds } } }, { $group: { _id: '$marketId', c: { $sum: 1 } } }]),
      Bet.aggregate([{ $match: { marketId: { $in: marketIds } } }, { $group: { _id: '$marketId', c: { $sum: 1 } } }]),
    ]);
    const rMap = new Map(roundCounts.map((r: any) => [String(r._id), r.c]));
    const bMap = new Map(betCounts.map((r: any) => [String(r._id), r.c]));
    return markets.map(m => ({
      id: String(m._id),
      name: (m as any).name,
      type: (m as any).type,
      description: (m as any).description ?? null,
      isActive: (m as any).isActive,
      config: (m as any).config,
      createdAt: (m as any).createdAt,
      updatedAt: (m as any).updatedAt,
      _count: { rounds: rMap.get(String(m._id)) || 0, bets: bMap.get(String(m._id)) || 0 },
    } as any));
  }

  async getMarketById(marketId: string) {
    const market = await Market.findById(marketId).lean();

    if (!market) {
      throw new NotFoundError('Market');
    }

    const recentRounds = await Round.find({ marketId: market._id })
      .sort({ roundNumber: -1 })
      .limit(10)
      .lean();
    const betCounts = await Bet.aggregate([
      { $match: { roundId: { $in: recentRounds.map(r => r._id) } } },
      { $group: { _id: '$roundId', c: { $sum: 1 } } },
    ]);
    const bMap = new Map(betCounts.map((r: any) => [String(r._id), r.c]));
    return {
      id: String((market as any)._id),
      name: (market as any).name,
      type: (market as any).type,
      description: (market as any).description ?? null,
      isActive: (market as any).isActive,
      config: (market as any).config,
      createdAt: (market as any).createdAt,
      updatedAt: (market as any).updatedAt,
      rounds: recentRounds.map(r => ({
        id: String(r._id),
        marketId: r.marketId,
        roundNumber: r.roundNumber,
        status: r.status,
        openedAt: r.openedAt,
        lockedAt: r.lockedAt,
        revealedAt: r.revealedAt,
        settledAt: r.settledAt,
        queuedAt: r.queuedAt,
        releasedAt: r.releasedAt,
        scheduledReleaseAt: r.scheduledReleaseAt,
        releaseGroupId: (r as any).releaseGroupId,
        _count: { bets: bMap.get(String(r._id)) || 0 },
      })),
    } as any;
  }

  async getMarketByType(type: MarketType) {
    const market = await Market.findOne({ type }).lean();
    if (!market) return null as any;
    const round = await Round.findOne({ marketId: market._id, status: 'PREDICTING' }).sort({ roundNumber: -1 }).lean();
    return { ...market, rounds: round ? [round] : [] } as any;
  }

  async getActiveRounds() {
    const rounds = await Round.find({ status: 'PREDICTING' }).sort({ openedAt: 1 }).lean();
    const marketIds = Array.from(new Set(rounds.map(r => r.marketId)));
    const markets = await Market.find({ _id: { $in: marketIds } }).select('name type config').lean();
    const mMap = new Map(markets.map((m: any) => [String(m._id), m]));
    const betCounts = await Bet.aggregate([{ $match: { roundId: { $in: rounds.map(r => r._id) } } }, { $group: { _id: '$roundId', c: { $sum: 1 } } }]);
    const bMap = new Map(betCounts.map((r: any) => [String(r._id), r.c]));
    return rounds.map(r => ({
      id: String(r._id),
      marketId: r.marketId,
      roundNumber: r.roundNumber,
      status: r.status,
      openedAt: r.openedAt,
      lockedAt: r.lockedAt,
      revealedAt: r.revealedAt,
      settledAt: r.settledAt,
      queuedAt: r.queuedAt,
      releasedAt: r.releasedAt,
      scheduledReleaseAt: r.scheduledReleaseAt,
      releaseGroupId: (r as any).releaseGroupId,
      market: mMap.get(String(r.marketId)),
      _count: { bets: bMap.get(String(r._id)) || 0 },
    })) as any;
  }

  async getMarketHistory(marketId: string, limit: number = 50) {
    const market = await Market.findById(marketId).lean();

    if (!market) {
      throw new NotFoundError('Market');
    }

    const rounds = await Round.find({ marketId, status: 'SETTLED' }).sort({ settledAt: -1 }).limit(limit).lean();
    const betCounts = await Bet.aggregate([{ $match: { roundId: { $in: rounds.map(r => r._id) } } }, { $group: { _id: '$roundId', c: { $sum: 1 } } }]);
    const bMap = new Map(betCounts.map((r: any) => [String(r._id), r.c]));
    return rounds.map(r => ({
      id: String(r._id),
      marketId: r.marketId,
      roundNumber: r.roundNumber,
      status: r.status,
      openedAt: r.openedAt,
      lockedAt: r.lockedAt,
      revealedAt: r.revealedAt,
      settledAt: r.settledAt,
      queuedAt: r.queuedAt,
      releasedAt: r.releasedAt,
      scheduledReleaseAt: r.scheduledReleaseAt,
      releaseGroupId: (r as any).releaseGroupId,
      _count: { bets: bMap.get(String(r._id)) || 0 },
    })) as any;
  }

  async updateHouseEdgeBps(marketId: string, houseEdgeBps: number, user: { id: string; walletAddress: string }) {
    if (houseEdgeBps < 0 || houseEdgeBps > 10000) {
      throw new ValidationError('houseEdgeBps must be between 0 and 10000');
    }

    const market = await Market.findById(marketId).lean();
    if (!market) {
      throw new NotFoundError('Market');
    }

    const adminKeypair = getAdminKeypair();
    if (user.walletAddress.toLowerCase() !== adminKeypair.publicKey.toString().toLowerCase()) {
      throw new AuthenticationError('Admin only');
    }

    const cfg = getMarketConfig(market.config as unknown);
    const marketPubkey = new PublicKey(cfg.solanaAddress);

    const signature = await tokkuProgram.setHouseEdgeBps(marketPubkey, houseEdgeBps, adminKeypair);

    const newConfig = { ...cfg, houseEdgeBps } as any;
    await Market.updateOne({ _id: marketId }, { $set: { config: newConfig } });

    return { marketId, houseEdgeBps, tx: signature };
  }

  async updateHouseEdgeBpsByType(type: string, houseEdgeBps: number, user: { id: string; walletAddress: string }) {
    if (houseEdgeBps < 0 || houseEdgeBps > 10000) {
      throw new ValidationError('houseEdgeBps must be between 0 and 10000');
    }

    const adminKeypair = getAdminKeypair();
    if (user.walletAddress.toLowerCase() !== adminKeypair.publicKey.toString().toLowerCase()) {
      throw new AuthenticationError('Admin only');
    }

    const isValidType = (Object.values(MarketType) as string[]).includes(type);
    if (!isValidType) {
      throw new ValidationError('Invalid market type');
    }
    const markets = await Market.find({ type }).lean();
    if (!markets.length) return { updated: 0, signatures: [] as string[] };

    const signatures: string[] = [];
    for (const market of markets) {
      const cfg = getMarketConfig(market.config as unknown);
      const marketPubkey = new PublicKey(cfg.solanaAddress);
      const sig = await tokkuProgram.setHouseEdgeBps(marketPubkey, houseEdgeBps, adminKeypair);
      const newConfig = { ...cfg, houseEdgeBps } as any;
      await Market.updateOne({ _id: market._id }, { $set: { config: newConfig } });
      signatures.push(sig);
    }

    return { updated: markets.length, signatures };
  }
}
