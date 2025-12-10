import { Market, Round, Bet } from '@/config/database'
import { RoundStatus } from '@/shared/types'
import { RoundsService } from '@/features/rounds/rounds.service'
import { logger } from '@/utils/logger'
import { config } from '@/config/env'

const roundsService = new RoundsService()

class SchedulerLock {
  private running = false
  private runningTimestamp: number | null = null
  private readonly TIMEOUT_MS = 120000

  async acquire(): Promise<boolean> {
    if (this.running && this.runningTimestamp) {
      const elapsed = Date.now() - this.runningTimestamp
      if (elapsed > this.TIMEOUT_MS) {
        logger.warn({ elapsed, timeout: this.TIMEOUT_MS }, 'Auto-open scheduler lock timeout, forcing release')
        this.release()
      } else {
        return false
      }
    }

    if (this.running) {
      return false
    }

    this.running = true
    this.runningTimestamp = Date.now()
    return true
  }

  release(): void {
    this.running = false
    this.runningTimestamp = null
  }

  isRunning(): boolean {
    return this.running
  }
}

const schedulerLock = new SchedulerLock()

export async function autoOpenRounds() {
  if (!await schedulerLock.acquire()) {
    return
  }

  try {
    const markets = await Market.find({ isActive: true }).select('_id name').lean()
    if (markets.length === 0) return

    const now = Date.now()
    const intervalMs = config.ROUND_RELEASE_INTERVAL_SECONDS * 1000
    const bufferMs = config.ROUND_QUEUE_BUFFER_SECONDS * 1000
    const targetTimestamp = Math.ceil((now + bufferMs) / intervalMs) * intervalMs
    const scheduledReleaseAt = new Date(targetTimestamp)
    const releaseGroupId = `batch-${scheduledReleaseAt.getTime()}`

    for (const market of markets) {
      const latest = await Round.findOne({ marketId: market._id }).sort({ roundNumber: -1 }).lean()

      if (latest) {
        if (latest.status === RoundStatus.PREDICTING) {
          logger.debug({ marketId: market._id, roundId: latest._id }, 'Market already has active round, skipping queue')
          continue
        }
        if (latest.status === RoundStatus.LOCKED) {
          const betCount = await Bet.countDocuments({ roundId: latest._id })
          if (betCount === 0) {
            try {
              await roundsService.undelegateRound(String(latest._id))
              logger.info({ roundId: latest._id, marketId: market._id }, 'Expired stale locked round (no bets)')
            } catch (e) {
              logger.error({ roundId: latest._id, err: e }, 'Failed to expire stale locked round')
            }
          } else {
            logger.debug({ marketId: market._id, roundId: latest._id }, 'Locked round awaiting settlement; queuing next')
          }
        }

        if (latest.status === RoundStatus.QUEUED) {
          const scheduled = latest.scheduledReleaseAt ? new Date(latest.scheduledReleaseAt).getTime() : null
          if (scheduled && Math.abs(scheduled - scheduledReleaseAt.getTime()) < intervalMs) {
            logger.debug({ marketId: market._id, roundId: latest._id }, 'Round already queued for upcoming batch')
            continue
          }
        }
      }

      try {
        const round = await roundsService.queueRound(String(market._id), scheduledReleaseAt, releaseGroupId)
        if (round.status === RoundStatus.QUEUED) {
          logger.info({ marketId: market._id, marketName: market.name, roundId: (round as any)._id, releaseGroupId }, 'Queued round for batch release')
        } else {
          logger.debug({ marketId: market._id, status: round.status }, 'Queue skipped due to existing round state')
        }
      } catch (e) {
        logger.error({ marketId: market._id, err: e }, 'Queue round failed')
      }
    }
  } catch (error) {
    logger.error({ error }, 'Auto-open scheduler error')
  } finally {
    schedulerLock.release()
  }
}
