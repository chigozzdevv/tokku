import { Schema, model, Document } from 'mongoose'

export interface IUser extends Document {
  _id: string
  walletAddress: string
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<IUser>({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

export const User = model<IUser>('User', userSchema)
