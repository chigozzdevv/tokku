import { Schema, model, Document, Types } from 'mongoose'

export interface IStreak extends Document {
  _id: string
  userId: Types.ObjectId
  marketId?: Types.ObjectId | null
  currentStreak: number
  target: number
  status: 'ACTIVE' | 'COMPLETED' | 'FAILED'
  startedAt: Date
  completedAt?: Date
  lastRoundId?: string
  createdAt: Date
  updatedAt: Date
}

const streakSchema = new Schema<IStreak>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  marketId: { type: Schema.Types.ObjectId, ref: 'Market', default: null, index: true },
  currentStreak: { type: Number, default: 0 },
  target: { type: Number, required: true },
  status: { type: String, enum: ['ACTIVE','COMPLETED','FAILED'], default: 'ACTIVE', index: true },
  startedAt: { type: Date, default: () => new Date(), index: true },
  completedAt: { type: Date },
  lastRoundId: { type: String },
}, { timestamps: true })

streakSchema.index({ userId: 1, marketId: 1, status: 1 })

export const Streak = model<IStreak>('Streak', streakSchema)
