import { Schema, model, Document, Types } from 'mongoose'

export interface IRound extends Document {
  _id: string
  marketId: Types.ObjectId
  roundNumber: number
  status: 'QUEUED' | 'PREDICTING' | 'LOCKED' | 'REVEALED' | 'SETTLED' | 'FAILED'
  openedAt?: Date
  lockedAt?: Date
  revealedAt?: Date
  settledAt?: Date
  queuedAt?: Date
  releasedAt?: Date
  scheduledReleaseAt?: Date
  releaseGroupId?: string
  outcome?: Record<string, any>
  entropy?: Record<string, any>
  attestation?: Record<string, any>
  solanaAddress?: string
  delegateTxHash?: string
  lockTxHash?: string
  revealTxHash?: string
  commitTxHash?: string
  commitStateTxHash?: string
  baseLayerCommitTxHash?: string
  undelegateTxHash?: string
  baseLayerUndelegateTxHash?: string
  openTxHash?: string
  createdAt: Date
  updatedAt: Date
  market?: any
  betsCount?: number
}

const roundSchema = new Schema<IRound>({
  marketId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Market', 
    required: true
  },
  roundNumber: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['QUEUED', 'PREDICTING', 'LOCKED', 'REVEALED', 'SETTLED', 'FAILED'],
    default: 'QUEUED'
  },
  openedAt: { type: Date },
  lockedAt: { type: Date },
  revealedAt: { type: Date },
  settledAt: { type: Date },
  queuedAt: { type: Date },
  releasedAt: { type: Date },
  scheduledReleaseAt: { type: Date },
  releaseGroupId: { type: String },
  outcome: { type: Schema.Types.Mixed },
  entropy: { type: Schema.Types.Mixed },
  attestation: { type: Schema.Types.Mixed },
  solanaAddress: { type: String },
  delegateTxHash: { type: String },
  lockTxHash: { type: String },
  revealTxHash: { type: String },
  commitTxHash: { type: String },
  commitStateTxHash: { type: String },
  baseLayerCommitTxHash: { type: String },
  undelegateTxHash: { type: String },
  baseLayerUndelegateTxHash: { type: String },
  openTxHash: { type: String },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// TTL: Auto-delete after 24 hours
roundSchema.index({ openedAt: 1 }, { expireAfterSeconds: 86400 })
roundSchema.index({ queuedAt: 1 }, { expireAfterSeconds: 86400 })

// Compound indexes for common queries
roundSchema.index({ marketId: 1, status: 1 })
roundSchema.index({ status: 1, openedAt: 1 })
roundSchema.index({ releaseGroupId: 1, scheduledReleaseAt: 1 })

// Ensure uniqueness per market round number
roundSchema.index({ marketId: 1, roundNumber: 1 }, { unique: true })

// Virtual for bets count (will be populated separately)
roundSchema.virtual('_count', {
  ref: 'Bet',
  localField: '_id',
  foreignField: 'roundId',
  count: true
})

export const Round = model<IRound>('Round', roundSchema)
