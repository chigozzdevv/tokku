declare module '@magicblock-labs/ephemeral-rollups-sdk/lib/privacy/verify.js' {
  export function verifyTeeRpcIntegrity(rpcUrl: string): Promise<boolean>;
}

declare module '@magicblock-labs/ephemeral-rollups-sdk/lib/privacy/auth.js' {
  import { PublicKey } from '@solana/web3.js';

  export function getAuthToken(
    rpcUrl: string,
    publicKey: PublicKey,
    signMessage: (message: Uint8Array) => Promise<Uint8Array>
  ): Promise<string>;
}
