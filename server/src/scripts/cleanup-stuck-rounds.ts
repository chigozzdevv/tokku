import { Round, connectDatabase, disconnectDatabase } from '@/config/database'
import { config } from '@/config/env'

async function cleanupStuckRounds() {
  try {
    await connectDatabase()
    const now = new Date()
    const ROUND_DURATION_MS = config.ROUND_DURATION_SECONDS * 1000
    const lockThreshold = new Date(now.getTime() - ROUND_DURATION_MS)

    console.log(`Looking for PREDICTING rounds opened before: ${lockThreshold.toISOString()}`)

    const stuckRounds = await Round.find({ status: 'PREDICTING', openedAt: { $lte: lockThreshold } })
      .select('roundNumber openedAt marketId')
      .populate({ path: 'marketId', select: 'name', model: 'Market' })
      .lean()

    console.log(`Found ${stuckRounds.length} stuck rounds\n`)

    if (stuckRounds.length === 0) {
      console.log('No stuck rounds to clean up')
      return
    }

    for (const round of stuckRounds) {
      const opened = new Date(round.openedAt!)
      const elapsed = Math.floor((now.getTime() - opened.getTime()) / 1000 / 60)
      console.log(`  ${(round as any).marketId?.name} #${round.roundNumber} - opened ${elapsed}m ago`)
    }

    console.log('\nMarking these rounds as FAILED...')
    
    const result = await Round.updateMany({ _id: { $in: stuckRounds.map((r: any) => r._id) } }, { $set: { status: 'FAILED' } })

    console.log(`\n✓ Marked ${(result as any).modifiedCount} rounds as FAILED`)
    console.log('New rounds can now be created for these markets')

    await disconnectDatabase()
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

cleanupStuckRounds()
