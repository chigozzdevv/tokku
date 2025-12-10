import { Schema, model, Document, Types } from 'mongoose'

export interface IAttestation extends Document {
  _id: string
  hash: string
  roundId?: Types.ObjectId
  type: string
  payload: any
  signature?: string
  verified: boolean
  txHash?: string
  createdAt: Date
  updatedAt: Date
}

const attestationSchema = new Schema<IAttestation>({
  hash: { type: String, required: true, unique: true, index: true },
  roundId: { type: Schema.Types.ObjectId, ref: 'Round' },
  type: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  signature: { type: String },
  verified: { type: Boolean, default: false, index: true },
  txHash: { type: String },
}, {
  timestamps: true,
})

export const Attestation = model<IAttestation>('Attestation', attestationSchema)
