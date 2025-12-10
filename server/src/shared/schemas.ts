import { z } from 'zod';
import { BetSelection } from './types';

// Auth schemas
export const walletAuthSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  signature: z.string().min(1, 'Signature is required'),
  publicKey: z.string().min(1, 'Public key is required'),
});

// Market schemas
export const marketParamsSchema = z.object({
  marketId: z.string().min(1, 'Market ID is required'),
});

export const roundParamsSchema = z.object({
  roundId: z.string().min(1, 'Round ID is required'),
});

// Bet schemas
// Shared selection schemas used in the discriminated union
export const rangeSelectionSchema = z.object({
  type: z.literal('range'),
  min: z.number().int().min(0).max(100),
  max: z.number().int().min(0).max(100),
}).refine((val) => val.min <= val.max, 'Min must be less than or equal to max');

// Shape market specific
export const shapeSelectionSchema = z.object({
  type: z.literal('shape'),
  shape: z.enum(['circle', 'square', 'triangle', 'star']),
  color: z.enum(['red', 'blue', 'green', 'yellow', 'purple', 'orange']).optional(),
  size: z.enum(['small', 'medium', 'large']).optional(),
});

// Entropy market specific
export const entropySelectionSchema = z.object({
  type: z.literal('entropy'),
  source: z.enum(['tee', 'chain', 'sensor']),
  comparison: z.enum(['>', '<', '=']),
  target: z.enum(['tee', 'chain', 'sensor']).optional(),
});

// Streak market specific
export const streakSelectionSchema = z.object({
  type: z.literal('streak'),
  target: z.number().int().min(2).max(5),
});

// Community seed specific
export const communitySelectionSchema = z.object({
  type: z.literal('community'),
  byte: z.number().int().min(0).max(255),
});

// Bet selection schema (discriminated union on `type`)
const singleSelectionSchema = z.object({
  type: z.literal('single'),
  value: z.number().int().min(1).max(100),
});

const paritySelectionSchema = z.object({
  type: z.literal('parity'),
  value: z.enum(['even', 'odd']),
});

const digitSelectionSchema = z.object({
  type: z.literal('digit'),
  value: z.number().int().min(0).max(9),
});

const moduloSelectionSchema = z.object({
  type: z.literal('modulo'),
  value: z.number().int().min(0).max(2),
});

export const betSelectionSchema = z.discriminatedUnion('type', [
  rangeSelectionSchema,
  singleSelectionSchema,
  paritySelectionSchema,
  digitSelectionSchema,
  moduloSelectionSchema,
  shapeSelectionSchema,
  entropySelectionSchema,
  streakSelectionSchema,
  communitySelectionSchema,
]) as unknown as z.ZodType<BetSelection>;

export const placeBetSchema = z.object({
  roundId: z.string().min(1, 'Round ID is required'),
  selection: betSelectionSchema,
  stake: z.number().positive('Stake must be positive').max(
    100_000_000_000, // 100 SOL max
    'Maximum stake exceeded'
  ),
});

// Pagination
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Query filters
export const roundQuerySchema = z.object({
  marketId: z.string().optional(),
  status: z.enum(['PREDICTING', 'LOCKED', 'REVEALED', 'SETTLED']).optional(),
  ...paginationSchema.shape,
});

export const betQuerySchema = z.object({
  status: z.enum(['PENDING', 'WON', 'LOST', 'REFUNDED']).optional(),
  marketId: z.string().optional(),
  ...paginationSchema.shape,
});

export const leaderboardQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'all-time']).default('all-time'),
  ...paginationSchema.shape,
});
