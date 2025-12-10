import mongoose from 'mongoose';
import { PublicKey } from '@solana/web3.js';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { RoundsService } from '@/features/rounds/rounds.service';
import { Market } from '@/features/markets/markets.model';
import { getMarketConfig } from '@/utils/market-config';
import { Round } from '@/features/rounds/rounds.model';

const roundsService = new RoundsService();

async function main() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    logger.info('Connected to MongoDB');

    const roundArg = process.argv.find((arg) => arg.startsWith('--round='));
    const explicitRoundId = roundArg ? roundArg.split('=')[1] : undefined;

    let round: any = null;
    if (explicitRoundId) {
      round = await Round.findById(explicitRoundId).lean();
    } else {
      round =
        (await Round.findOne({
          solanaAddress: { $exists: true, $ne: null },
          delegateTxHash: { $exists: true, $ne: null },
          $or: [{ undelegateTxHash: { $exists: false } }, { undelegateTxHash: null }],
        })
          .sort({ lockedAt: -1, openedAt: -1 })
          .lean()) ||
        (await Round.findOne({
          status: { $in: ['PREDICTING', 'LOCKED'] },
          solanaAddress: { $exists: true, $ne: null },
          $or: [{ delegateTxHash: { $exists: false } }, { delegateTxHash: null }],
        })
          .sort({ lockedAt: -1, openedAt: -1 })
          .lean());
    }

    if (!round) {
      logger.error('No suitable round found for delegation test');
      return;
    }

    const needsDelegation = !round.delegateTxHash;

    const market = await Market.findById(round.marketId).lean();
    if (!market) {
      logger.error({ marketId: String(round.marketId) }, 'Market not found for round');
      return;
    }

    const marketConfig = getMarketConfig((market as any).config);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    logger.info(
      {
        roundId: String(round._id),
        marketId: String(market._id),
        marketPubkey: marketPubkey.toBase58(),
      },
      'Preparing to delegate round'
    );

    if (needsDelegation) {
      await roundsService.delegateRoundToER(String(round._id), marketPubkey);
      round = (await Round.findById(round._id).lean())!;
      logger.info(
        {
          roundId: String(round._id),
          delegateTxHash: round.delegateTxHash,
        },
        'Round delegated to ER'
      );
    } else {
      logger.info(
        {
          roundId: String(round._id),
          delegateTxHash: round.delegateTxHash,
        },
        'Round already delegated; proceeding to undelegate'
      );
    }

    const undelegateTxHash = await roundsService.undelegateRound(String(round._id));
    logger.info(
      {
        roundId: String(round._id),
        undelegateTxHash,
      },
      'Round undelegated from ER'
    );
  } catch (error) {
    logger.error({ error }, 'Delegate/undelegate test failed');
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
