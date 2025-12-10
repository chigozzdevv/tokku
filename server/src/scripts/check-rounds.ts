import { Round, Market, connectDatabase, disconnectDatabase } from '@/config/database'

async function checkRounds() {
  try {
    await connectDatabase()
    const totalRounds = await Round.countDocuments()
    console.log(`Total rounds: ${totalRounds}`)

    const roundsByStatus = await Round.aggregate([{ $group: { _id: '$status', _count: { $sum: 1 } } }])
    console.log('\nRounds by status:')
    roundsByStatus.forEach(({ status, _count }) => {
      console.log(`  ${status}: ${_count}`)
    })

    const recentRounds = await Round.find({}, { roundNumber: 1, status: 1, openedAt: 1, lockedAt: 1, queuedAt: 1, scheduledReleaseAt: 1, marketId: 1 })
      .sort({ roundNumber: -1 })
      .limit(10)
      .lean()

    console.log('\nRecent 10 rounds:')
    recentRounds.forEach((round) => {
      console.log(`  [${round.status}] ${round.marketId} #${round.roundNumber}`)
      console.log(`    Queued: ${round.queuedAt || 'N/A'}`)
      console.log(`    Scheduled: ${round.scheduledReleaseAt || 'N/A'}`)
      console.log(`    Opened: ${round.openedAt || 'N/A'}`)
    })

    const markets = await Market.find({ isActive: true }).select('_id name').lean()

    console.log(`\nActive markets: ${markets.length}`)
    for (const market of markets) {
      const latest = await Round.findOne({ marketId: market._id }).sort({ roundNumber: -1 }).select('roundNumber status openedAt').lean()
      console.log(`  ${market.name}: Round #${latest?.roundNumber || 0} (${latest?.status || 'NONE'})`)
    }

    await disconnectDatabase()
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

checkRounds()
