import { Keypair } from '@solana/web3.js';
import { config } from './env';
import { logger } from '@/utils/logger';

let adminKeypair: Keypair | null = null;

export function getAdminKeypair(): Keypair {
  if (adminKeypair) {
    return adminKeypair;
  }

  try {
    if (!config.ADMIN_PRIVATE_KEY) {
      throw new Error('ADMIN_PRIVATE_KEY not configured in environment');
    }

    const secretKey = JSON.parse(config.ADMIN_PRIVATE_KEY);
    adminKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
    
    logger.info({ publicKey: adminKeypair.publicKey.toString() }, 'Admin keypair loaded');
    
    return adminKeypair;
  } catch (error: any) {
    logger.error({ err: error }, 'Failed to load admin keypair');
    throw new Error(`Admin keypair initialization failed: ${error.message}`);
  }
}

export function getAdminPublicKey() {
  return getAdminKeypair().publicKey;
}
