import { RoundsService } from '@/features/rounds/rounds.service'
import { Round, connectDatabase, disconnectDatabase } from '@/config/database'

async function forceLockRound() {
  try {
    await connectDatabase()
    const roundsService = new RoundsService()
    
    const round = await Round.findOne({ status: 'PREDICTING' })
      .sort({ openedAt: 1 })
      .select('roundNumber marketId')
      .populate({ path: 'marketId', select: 'name', model: 'Market' })
      .lean()

    if (!round) {
      console.log('No PREDICTING rounds found')
      return
    }

    console.log(`Attempting to lock: ${(round as any).marketId?.name} #${round.roundNumber} (${(round as any)._id})`)
    
    const result = await roundsService.lockRound(String((round as any)._id))
    console.log('Lock successful!')
    console.log('Result:', result)
    
    await disconnectDatabase()
  } catch (error: any) {
    console.error('Lock failed!')
    console.error('Error:', error.message)
    console.error('Stack:', error.stack)
    process.exit(1)
  }
}

forceLockRound()
