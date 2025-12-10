import { Round, Market, connectDatabase, disconnectDatabase } from '@/config/database'
import { config } from '@/config/env'

async function checkRoundTiming() {
  try {
    await connectDatabase()
    const predictingRounds = await Round.find({ status: 'PREDICTING' })
      .select('roundNumber openedAt marketId')
      .populate({ path: 'marketId', select: 'name', model: 'Market' })
      .lean()

    const now = new Date()
    const ROUND_DURATION_MS = config.ROUND_DURATION_SECONDS * 1000

    console.log(`Current time: ${now.toISOString()}`)
    console.log(`Round duration: ${config.ROUND_DURATION_SECONDS} seconds`)
    console.log(`\nPREDICTING Rounds:\n`)

    for (const round of predictingRounds) {
      const opened = new Date(round.openedAt as any)
      const shouldLockAt = new Date(opened.getTime() + ROUND_DURATION_MS)
      const elapsed = now.getTime() - opened.getTime()
      const remaining = shouldLockAt.getTime() - now.getTime()
      const elapsedMinutes = Math.floor(elapsed / 1000 / 60)
      const elapsedSeconds = Math.floor((elapsed / 1000) % 60)
      const remainingMinutes = Math.floor(remaining / 1000 / 60)
      const remainingSeconds = Math.floor((remaining / 1000) % 60)

      console.log(`${(round as any).marketId?.name} #${round.roundNumber}`)
      console.log(`  Opened at:  ${opened.toISOString()}`)
      console.log(`  Should lock: ${shouldLockAt.toISOString()}`)
      console.log(`  Elapsed:    ${elapsedMinutes}m ${elapsedSeconds}s`)
      console.log(`  Remaining:  ${remainingMinutes}m ${remainingSeconds}s`)
      console.log(`  Status:     ${remaining > 0 ? 'ACTIVE' : 'SHOULD BE LOCKED!'}`)
      console.log()
    }

    await disconnectDatabase()
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

checkRoundTiming()
