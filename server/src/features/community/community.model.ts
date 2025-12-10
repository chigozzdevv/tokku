import { Schema, model, Document, Types } from 'mongoose'

export interface ICommunitySeed extends Document {
  _id: string
  userId: Types.ObjectId
  roundId: Types.ObjectId
  byte: number
  distance?: number | null
  won: boolean
  createdAt: Date
  updatedAt: Date
}

const communitySeedSchema = new Schema<ICommunitySeed>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  roundId: { type: Schema.Types.ObjectId, ref: 'Round', required: true, index: true },
  byte: { type: Number, required: true },
  distance: { type: Number, default: null },
  won: { type: Boolean, default: false, index: true },
}, { timestamps: true })

communitySeedSchema.index({ userId: 1, roundId: 1 }, { unique: true })

export const CommunitySeed = model<ICommunitySeed>('CommunitySeed', communitySeedSchema)
