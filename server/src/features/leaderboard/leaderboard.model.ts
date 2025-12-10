import { Schema, model, Document, Types } from 'mongoose'

export interface ILeaderboardEntry extends Document {
  _id: string
  userId: Types.ObjectId
  totalBets: number
  totalWon: number
  totalStake: number
  totalPayout: number
  winRate: number
  streak: number
  updatedAt: Date
  createdAt: Date
}

const leaderboardSchema = new Schema<ILeaderboardEntry>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  totalBets: { type: Number, default: 0 },
  totalWon: { type: Number, default: 0 },
  totalStake: { type: Number, default: 0 },
  totalPayout: { type: Number, default: 0 },
  winRate: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
}, { timestamps: true })

export const LeaderboardEntry = model<ILeaderboardEntry>('LeaderboardEntry', leaderboardSchema)
