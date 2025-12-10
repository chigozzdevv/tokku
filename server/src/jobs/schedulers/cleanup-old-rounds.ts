import { Round } from '@/config/database'
import { logger } from '@/utils/logger'

export async function cleanupOldRounds() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    
    const result = await Round.deleteMany({
      $or: [
        { openedAt: { $lte: twentyFourHoursAgo } },
        { queuedAt: { $lte: twentyFourHoursAgo } },
      ],
      status: { $in: ['FAILED', 'SETTLED'] },
    })

    if ((result as any).deletedCount > 0) {
      logger.info({ count: (result as any).deletedCount }, 'Cleaned up old rounds (24hr+)')
    }
  } catch (error) {
    logger.error({ error }, 'Cleanup old rounds scheduler error')
  }
}
