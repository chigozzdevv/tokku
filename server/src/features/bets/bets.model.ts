import { Schema, model, Document, Types } from 'mongoose'

export interface IBet extends Document {
  _id: string
  userId: Types.ObjectId
  roundId: Types.ObjectId
  marketId: Types.ObjectId
  selection: Record<string, any>
  stake: number
  payout?: number
  odds: number
  status: 'PENDING' | 'WON' | 'LOST' | 'REFUNDED' | 'CANCELLED'
  solanaAddress?: string
  txSignature?: string
  createdAt: Date
  updatedAt: Date
}

const betSchema = new Schema<IBet>({
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true
  },
  roundId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Round', 
    required: true
  },
  marketId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Market', 
    required: true
  },
  selection: { 
    type: Schema.Types.Mixed, 
    required: true 
  },
  stake: { 
    type: Number, 
    required: true 
  },
  payout: { type: Number },
  odds: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['PENDING', 'WON', 'LOST', 'REFUNDED', 'CANCELLED'],
    default: 'PENDING'
  },
  solanaAddress: { type: String },
  txSignature: { type: String, unique: true, sparse: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// TTL: Auto-delete after 30 days
betSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 })

// Compound indexes
betSchema.index({ userId: 1, status: 1, createdAt: -1 })
betSchema.index({ roundId: 1, status: 1 })
betSchema.index({ marketId: 1, createdAt: -1 })

export const Bet = model<IBet>('Bet', betSchema)
