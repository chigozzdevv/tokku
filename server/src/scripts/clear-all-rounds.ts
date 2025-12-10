import { Round, connectDatabase, disconnectDatabase } from '@/config/database'

async function clearAllRounds() {
  try {
    await connectDatabase()
    console.log('Deleting all rounds...')
    
    const count = await Round.countDocuments()
    console.log(`Found ${count} rounds to delete`)
    
    await Round.deleteMany({})
    
    console.log('✓ All rounds cleared!')
    console.log('New rounds will be created on next scheduler run')
    
    await disconnectDatabase()
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

clearAllRounds()
