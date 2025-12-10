import { Schema, model, Document } from 'mongoose'

export interface IMarket extends Document {
  _id: string
  name: string
  type: string
  description?: string
  isActive: boolean
  config: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

const marketSchema = new Schema<IMarket>({
  name: { 
    type: String, 
    required: true, 
    unique: true
  },
  type: { 
    type: String, 
    required: true,
    enum: [
      'PICK_RANGE',
      'EVEN_ODD',
      'LAST_DIGIT',
      'MODULO_THREE',
      'PATTERN_OF_DAY',
      'SHAPE_COLOR',
      'JACKPOT',
      'ENTROPY_BATTLE',
      'STREAK_METER',
      'COMMUNITY_SEED'
    ]
  },
  description: { type: String },
  isActive: { 
    type: Boolean, 
    default: true
  },
  config: { 
    type: Schema.Types.Mixed,
    required: true
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

marketSchema.index({ isActive: 1, type: 1 })

export const Market = model<IMarket>('Market', marketSchema)
