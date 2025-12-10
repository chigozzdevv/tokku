# TOSSR.gg — Provably Random Gaming with MagicBlock ER + VRF + TEE

View demo [here](https://youtu.be/vcAsKuCF6Qg)

TOSSR.gg is a provably-fair gaming platform on Solana that combines:
- MagicBlock Ephemeral Rollups (ER) for low‑latency, gasless UX and fast state commits
- MagicBlock VRF for verifiable 32‑byte randomness
- TEE (Trusted Execution Environment) for private outcome generation with attestations

Each betting round follows: Predict → Lock → Reveal → Settle. We use base-first flow for user bets and VRF (to interop with base-native ops like ATA creation), then leverage ER for fast reveal and settlement, and finally anchor state back to Solana base.

## Monorepo Layout

```
.
├── client      # React + Vite app (wallet adapter, betting UI)
├── server      # Fastify API, Jobs, Solana + MagicBlock integration
└── contracts   # On-chain programs (Anchor) and TEE utilities (Rust)
```

## Architecture Overview

1) Predict (base-first)
- Client requests a bet transaction from the server and submits on base (SOLANA_RPC_URL). Base-native ops (e.g., minting ATAs) work seamlessly.

2) Lock
- Server locks the round on-chain (ER when delegated, base otherwise).
- Server requests VRF for the round (ER or base) and observes inputsHash first on ER.

3) Prove
- TEE generates the outcome with inputs (VRF randomness, chain hash, community seeds), returning an attestation (commitment_hash, nonce, signature, code measurement).

4) Commit + Reveal
- Non‑delegated: server commits hidden commitment hash on base, then reveals with nonce + inputsHash.
- Delegated: server uses ER reveal path (no base pre‑commit), then commits round state back to base for anchoring.

5) Settle
- Bets are settled and payouts distributed.

---

## MagicBlock ER: Where and How We Use It

### 1) Low‑latency blockhash sourcing and sends (Router → ER → Base fallback)
Server prefers Magic Router or ER RPC when `useER` is set, falling back to base as needed.

```ts
// server/src/solana/tossr-program-service.ts
private async getErBlockhashForTransaction(tx: Transaction) {
  if (this.routerConnection) {
    const routerBlockhash = await this.routerConnection.getLatestBlockhashForTransaction(tx);
    if (routerBlockhash?.blockhash) {
      (tx as any).__mb_blockhash_source = 'router';
      return routerBlockhash;
    }
  }
  const res = await this.erConnection.getLatestBlockhash();
  (tx as any).__mb_blockhash_source = 'er';
  return res;
}
```

Client routes bet submission to ER when the round is delegated:

```ts
// client/src/pages/dashboard/round-detail-page.tsx
const isRoundDelegated = round.delegateTxHash && !round.undelegateTxHash;
const submitRpcUrl = (transactionPayload as any)?.submitRpcUrl;
const sendConn = submitRpcUrl
  ? new Connection(submitRpcUrl, { commitment: 'confirmed' })
  : (isRoundDelegated ? new Connection(config.EPHEMERAL_RPC_URL, { commitment: 'confirmed' }) : connection);

const tx = Transaction.from(txBytes);
const { blockhash, lastValidBlockHeight } = await sendConn.getLatestBlockhash();
tx.recentBlockhash = blockhash;
(tx as any).lastValidBlockHeight = lastValidBlockHeight;
tx.feePayer = wallet.publicKey!;
const sig = await wallet.sendTransaction(tx, sendConn, { skipPreflight: true, preflightCommitment: 'confirmed' });
```

### 2) Delegation flow and prerequisites (vault ATAs on base and ER)
Before delegating a round, the server ensures required token accounts exist both on base and ER.

```ts
// server/src/features/rounds/rounds.service.ts
const vaultPda = await tossrProgram.getVaultPda(marketPubkey);
const vaultTokenAccount = await getAssociatedTokenAddress(mint, vaultPda, true);
// Create on base if missing ... then on ER if missing ...
const delegateTxHash = await tossrProgram.delegateRound(marketPubkey, round.roundNumber, adminKeypair);
await Round.updateOne({ _id: roundId }, { $set: { delegateTxHash } });
```

### 3) ER‑first state observation and VRF routing
Server requests VRF (ER or base) and then polls ER account first to detect inputsHash quickly.

```ts
// server/src/features/rounds/rounds.service.ts
await tossrProgram.requestRandomnessER(marketPubkey, round.roundNumber, clientSeed, adminKeypair, oracleQueue, { useER: isDelegated });
const [erState, baseState] = await Promise.all([
  fetchRoundStateRaw(erConnection, roundPda),
  fetchRoundStateRaw(baseConnection, roundPda),
]);
const state = erState && !/^0+$/.test(erState.inputsHash || '') ? erState : baseState;
```

### 4) Commit round state back to base after ER reveal
Commit via ER, then obtain the base‑layer signature from MagicBlock SDK and record both.

```ts
// server/src/solana/tossr-program-service.ts
const erTxHash = await this.sendAndConfirm(this.erConnection, tx, [payer], 'confirmed', true);
const baseTxHash = await GetCommitmentSignature(erTxHash, this.erConnection);
return { erTxHash, baseTxHash };
```

### 5) ER‑based reveal paths (numeric/shape/pattern/entropy/community)
When delegated, use ER reveal variants; otherwise reveal on base with nonce + inputsHash + attestation signature.

```ts
// server/src/features/rounds/rounds.service.ts
revealTxHash = isDelegated
  ? await tossrProgram.revealOutcomeER(marketPubkey, round.roundNumber, outcome.Numeric.value, adminKeypair)
  : await tossrProgram.revealOutcome(marketPubkey, round.roundNumber, outcome.Numeric.value, nonce, inputsHash, attestationSig, adminKeypair);
```

#### MagicBlock ER Use Cases Summary
- Low‑latency user betting with ER blockhash and Router submit.
- Round delegation to ER for rapid lock/reveal cycles.
- Preferential ER state observation for VRF inputsHash.
- Post‑reveal anchoring: commit round state from ER back to base layer.
- Robust fallbacks between Router, ER RPC, and base RPC.

---

## MagicBlock VRF: Request + Observe

VRF is requested on ER (or base). The 32‑byte inputsHash is detected by polling ER first.

```ts
// server/src/solana/tossr-program-service.ts
async requestRandomnessER(marketId, roundNumber, clientSeed, payer, oracleQueue, opts?: { useER?: boolean }) {
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketId, isSigner: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: oracleQueue, isSigner: false },
      { pubkey: PROGRAM_IDENTITY_PDA, isSigner: false },
      { pubkey: VRF_PROGRAM_PK, isSigner: false },
      { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false },
      { pubkey: SystemProgram.programId, isSigner: false },
    ],
    programId: TOSSR_PROGRAM_ID,
    data: Buffer.concat([DISCRIMINATORS.REQUEST_RANDOMNESS, Buffer.from([clientSeed & 0xff])]),
  });
  // send via ER or base
}
```

---

## TEE Attestations and Integrity

TEE generates outcomes with VRF randomness (+ chain hash/community seeds). Optional integrity checks and JWT auth use MagicBlock privacy APIs. Local fallback is available for development.

```ts
// server/src/solana/tee-service.ts
const { verifyTeeRpcIntegrity } = await import('@magicblock-labs/ephemeral-rollups-sdk/privacy');
const ok = await verifyTeeRpcIntegrity(this.teeRpcUrl);

const endpoint = await this.buildUrl('/generate_outcome');
const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ round_id: roundId, market_type: teeMarketType, params: { vrf_randomness: Array.from(vrfRandomness ?? []) } })
});
const attestation = await response.json();
```

---

## Contracts

- Anchor workspace: `contracts/anchor/programs/tossr-engine` (IDL consumed by server)
- TEE utilities crate: `contracts/tee-engine`

Build:
```bash
cd contracts/anchor && anchor build
cd contracts/tee-engine && cargo build
```

---

## Server

Tech: Fastify, TypeScript, MongoDB (Mongoose), Redis, Solana web3.js, MagicBlock ER + VRF.

Common scripts:
```bash
cd server
npm install
npm run dev                       # start API
npm run build && npm start        # production

# Utilities
npm run markets:list
npm run markets:create
npm run rounds:check
npm run demo:bootstrap            # end-to-end ER bet demo
npm run vrf:request               # trigger VRF for a round
```

API docs: http://localhost:3001/docs

Round lifecycle (key methods):
- Open/Delegate: `openRound`, `delegateRoundToER`
- Lock/VRF: `lockRound`, `prepareOutcome`
- Reveal: `revealOutcome`
- Commit back to base (ER only): `commitRoundStateToBase`

---

## Client

React + Vite. Delegated rounds automatically route bet submits to ER.

Env defaults (client/src/config/env.ts):
```ts
EPHEMERAL_RPC_URL: import.meta.env.VITE_EPHEMERAL_RPC_URL || 'https://devnet-router.magicblock.app',
EPHEMERAL_WS_URL:  import.meta.env.VITE_EPHEMERAL_WS_URL  || 'wss://devnet.magicblock.app',
```

---

## Environment Variables

Do not commit real secrets. Use placeholders for local dev.

Server (.env):
```
# App
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173

# Datastores
MONGODB_URI=mongodb://localhost:27017/tossr
REDIS_URL=redis://localhost:6379

# Solana / MagicBlock
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
EPHEMERAL_RPC_URL=https://devnet-router.magicblock.app
EPHEMERAL_WS_URL=wss://devnet-router.magicblock.app
TEE_RPC_URL=https://tee.magicblock.app

# Programs / queues (replace with your IDs)
VRF_ORACLE_QUEUE=REPLACE_WITH_QUEUE_PUBKEY
DELEGATION_PROGRAM_ID=REPLACE_WITH_PROGRAM_ID
MAGIC_PROGRAM_ID=REPLACE_WITH_PROGRAM_ID
TEE_PROGRAM_ID=REPLACE_WITH_PROGRAM_ID
PERMISSION_PROGRAM_ID=REPLACE_WITH_PROGRAM_ID
TOSSR_ENGINE_PROGRAM_ID=REPLACE_WITH_TOSSR_PROGRAM_ID

# Auth
JWT_SECRET=replace-with-strong-secret

# Admin (DO NOT COMMIT REAL KEYS)
ADMIN_PRIVATE_KEY=[REPLACE_WITH_SECRET_KEY_JSON_ARRAY]

# Optional
TEE_INTEGRITY_REQUIRED=false
TEE_PRIVATE_KEY_HEX=
ATTESTATION_CACHE_TTL=300
TEE_AUTH_CACHE_TTL=300
```

Client (.env):
```
VITE_API_URL=http://localhost:3001/api/v1
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_EPHEMERAL_RPC_URL=https://devnet-router.magicblock.app
VITE_EPHEMERAL_WS_URL=wss://devnet-router.magicblock.app
VITE_ROUND_DURATION_SECONDS=300
```

---

## Quick Start

```bash
# Server
cd server && npm i && npm run dev

# Client
cd ../client && npm i && npm run dev
```

Optional end‑to‑end ER demo:
```bash
cd server
npm run demo:bootstrap
```

---

## Security Notes

- NEVER commit real keys or production secrets.
- Verify program IDs and queue addresses per environment.
- If enabling TEE integrity checks, ensure TEE RPC endpoints are trusted and stable.

