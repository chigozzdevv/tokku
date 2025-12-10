export const config = {
  API_URL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1',
  SOLANA_RPC_URL: import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  EPHEMERAL_RPC_URL: import.meta.env.VITE_EPHEMERAL_RPC_URL || 'https://devnet-router.magicblock.app',
  EPHEMERAL_WS_URL: import.meta.env.VITE_EPHEMERAL_WS_URL || 'wss://devnet.magicblock.app',
}
