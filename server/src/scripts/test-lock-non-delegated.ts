import { RoundsService } from '@/features/rounds/rounds.service';
import { Round } from '@/features/rounds/rounds.model';
import { logger } from '@/utils/logger';
import mongoose from 'mongoose';
import { config } from '@/config/env';

const roundsService = new RoundsService();

async function testLockNonDelegated() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    logger.info('Connected to MongoDB');

    const round = await Round.findOne({
      status: 'PREDICTING',
      $or: [
        { delegateTxHash: { $exists: false } },
        { delegateTxHash: null }
      ]
    }).sort({ createdAt: -1 });

    if (!round) {
      logger.error('No non-delegated PREDICTING round found');
      process.exit(1);
    }

    logger.info({
      roundId: round._id,
      roundNumber: round.roundNumber,
      status: round.status,
      delegated: !!round.delegateTxHash
    }, 'Testing lock on non-delegated round');

    const lockResult = await roundsService.lockRound(round._id.toString());
    logger.info({ roundId: round._id, lockTxHash: lockResult }, 'Non-delegated round locked successfully');

  } catch (error) {
    logger.error({ error }, 'Test failed');
    console.error(error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

testLockNonDelegated();
