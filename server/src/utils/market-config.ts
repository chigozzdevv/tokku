import { z } from 'zod';
import { ValidationError } from '@/shared/errors';

export const marketConfigSchema = z.object({
  solanaAddress: z.string().min(1, 'Missing solanaAddress in market config'),
  mintAddress: z.string().optional(),
  houseEdgeBps: z.number().int().min(0).max(10000).optional(),
});

export type MarketConfig = z.infer<typeof marketConfigSchema>;

export function getMarketConfig(value: unknown): MarketConfig {
  const parsed = marketConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Invalid market configuration');
  }
  return parsed.data;
}
