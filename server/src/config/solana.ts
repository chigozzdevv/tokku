import { Connection, PublicKey } from '@solana/web3.js';
import { config } from './env';
import { SolanaConfig } from '@/shared/types';

export const solanaConfig: SolanaConfig = {
  rpcUrl: config.SOLANA_RPC_URL,
  wsUrl: config.SOLANA_WS_URL,
  programs: {
    delegation: config.DELEGATION_PROGRAM_ID,
    magic: config.MAGIC_PROGRAM_ID,
    tee: config.TEE_PROGRAM_ID,
  },
};

export const ephemeralConfig = {
  rpcUrl: config.EPHEMERAL_RPC_URL,
  wsUrl: config.EPHEMERAL_WS_URL,
};

export const teeConfig = {
  rpcUrl: config.TEE_RPC_URL,
};

// Initialize connections
export const solanaConnection = new Connection(config.SOLANA_RPC_URL, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
});

export const ephemeralConnection = new Connection(config.EPHEMERAL_RPC_URL, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
});

// Cache program public keys
export const programIds = {
  delegation: new PublicKey(config.DELEGATION_PROGRAM_ID),
  magic: new PublicKey(config.MAGIC_PROGRAM_ID),
  tee: new PublicKey(config.TEE_PROGRAM_ID),
};
