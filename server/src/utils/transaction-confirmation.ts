import { Connection } from '@solana/web3.js';
import { logger } from './logger';

export async function confirmTransactionHTTP(
  connection: Connection,
  signature: string,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
  timeoutMs: number = 60000,
  pollIntervalMs: number = 1000
): Promise<void> {
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const statuses = await connection.getSignatureStatuses([signature]);
      const status = statuses?.value?.[0];

      if (status) {
        if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }

        const confirmationStatus = status.confirmationStatus;

        if (commitment === 'finalized' && confirmationStatus === 'finalized') {
          return;
        }

        if (commitment === 'confirmed' && (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized')) {
          return;
        }

        if (commitment === 'processed' && confirmationStatus) {
          return;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    } catch (error: any) {
      const message = String(error?.message || '');

      if (message.includes('not found') || message.includes('could not find')) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        continue;
      }

      throw error;
    }
  }

  const elapsed = Date.now() - startTime;
  throw new Error(`Transaction confirmation timeout after ${elapsed}ms`);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (attempt: number, error: any) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
    onRetry
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts - 1) {
        const delay = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs
        );

        if (onRetry) {
          onRetry(attempt + 1, error);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
