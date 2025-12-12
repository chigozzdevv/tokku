import { Round, Bet, connectDatabase, disconnectDatabase } from '@/config/database'

async function clearAllRounds() {
  try {
    await connectDatabase()
    console.log('Deleting all rounds and bets...')

    const roundCount = await Round.countDocuments()
    const betCount = await Bet.countDocuments()
    console.log(`Found ${roundCount} rounds and ${betCount} bets to delete`)

    await Promise.all([
      Round.deleteMany({}),
      Bet.deleteMany({}),
    ])

    console.log('✓ All rounds and bets cleared!')
    console.log('New rounds will be created on next scheduler run')
    
    await disconnectDatabase()
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

clearAllRounds()
