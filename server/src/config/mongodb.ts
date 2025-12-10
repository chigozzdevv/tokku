import mongoose from 'mongoose'
import { config } from './env'
import { logger } from '@/utils/logger'

export async function connectDatabase() {
  try {
    await mongoose.connect(config.MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 120000,
    })
    
    logger.info('✓ Connected to MongoDB')
    
    mongoose.connection.on('error', (err) => {
      logger.error({ err }, 'MongoDB connection error')
    })
    
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected')
    })
    
  } catch (error) {
    logger.error({ error }, 'Failed to connect to MongoDB')
    process.exit(1)
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
  logger.info('Disconnected from MongoDB')
}

export { mongoose }
