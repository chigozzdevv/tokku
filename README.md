# Tokku — Provably Random Gaming on Solana

View demo [here](https://youtu.be/iLcglduopV8)

Tokku is a provably-fair random betting game on Solana where you predict outcomes in short, timed rounds. It combines:
- Ephemeral rollups (ER) for low‑latency and fast state commits
- VRF for verifiable 32‑byte randomness
- TEE (Trusted Execution Environment) for private outcome generation with attestations

Each betting round follows: Predict → Lock → Reveal → Settle. We use base-first flow for user bets and VRF (to interop with base-native ops like ATA creation), then leverage ER for fast reveal and settlement, and finally anchor state back to Solana base.

## Game Loop

1. Connect wallet
2. Pick a market (Even/Odd, Last Digit, Pick Range, etc.)
3. Choose your prediction + stake, then sign the bet transaction
4. Round locks → outcome is revealed on-chain
5. Winners are paid automatically (or refunded if something fails)
6. Verify bet / reveal / payout transactions in Solana Explorer

## Why Tokku is Solana-native

- On-chain rounds and bets use PDAs, so game state is public and deterministic
- Outcomes are revealed on-chain and settlements/refunds are executed on-chain
- Token payouts come from a market vault account, so everything is auditable in Explorer
- Verifiable randomness ensures outcomes are provably fair

## Tokku Platform Overview

### Markets (Game Types)

A market defines how you win.

Examples:
- Even / Odd
- Last Digit (0–9)
- Modulo Three (0, 1, 2)
- Pick Range (single number or range 1–100)
- Other markets: patterns, shapes/colors, entropy battle, streak meter, community seed

### Rounds (One Game Session)

Each round follows the same lifecycle:
1. Predict: betting is open
2. Lock: betting is closed
3. Reveal: outcome is published on-chain
4. Settle: bets are processed and payouts/refunds are sent

### Odds and Payouts

- Harder-to-win predictions pay higher odds; easier predictions pay lower odds.
- House edge (bps) slightly reduces the “perfectly fair” payout.
- If you win: `payout = stake × odds`
- If you lose: payout is 0
- If refunded: you receive your original stake back

### Funding & Payouts (Vault)

Each market has a program-derived vault (a PDA) that holds liquidity in an associated token account (vault ATA) for that market’s mint. Bets route funds into the vault, and settlement/refunds transfer from the vault back to each user’s token account. The vault is pre-funded by the market operator/admin for payout liquidity. For SOL markets, Tokku uses wrapped SOL (WSOL) token accounts.

### Transparency

Tokku preserves transaction signatures so users can verify:
- Bet transaction (proof you placed the bet)
- Outcome/reveal transaction (proof of outcome)
- Payout/refund transaction (proof funds moved)

## Monorepo Layout

```
.
├── client      # React + Vite app (wallet adapter, betting UI)
├── server      # Fastify API, Jobs, Solana + rollup/VRF/TEE integrations
└── contracts   # On-chain programs (Anchor) and TEE utilities (Rust)
```

## Technical Architecture Overview

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

## Fast execution path (Ephemeral Rollups)

Tokku can delegate rounds to an ephemeral rollup to reduce latency during lock/reveal, while still anchoring final state back to Solana base.

### 1) Low‑latency blockhash sourcing and sends (Router → ER → Base fallback)
Server prefers the Router or ER RPC when `useER` is set, falling back to base as needed.

```ts
// server/src/solana/tokku-program-service.ts
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
const vaultPda = await tokkuProgram.getVaultPda(marketPubkey);
const vaultTokenAccount = await getAssociatedTokenAddress(mint, vaultPda, true);
// Create on base if missing ... then on ER if missing ...
const delegateTxHash = await tokkuProgram.delegateRound(marketPubkey, round.roundNumber, adminKeypair);
await Round.updateOne({ _id: roundId }, { $set: { delegateTxHash } });
```

### 3) ER‑first state observation and VRF routing
Server requests VRF (ER or base) and then polls ER account first to detect inputsHash quickly.

```ts
// server/src/features/rounds/rounds.service.ts
await tokkuProgram.requestRandomnessER(marketPubkey, round.roundNumber, clientSeed, adminKeypair, oracleQueue, { useER: isDelegated });
const [erState, baseState] = await Promise.all([
  fetchRoundStateRaw(erConnection, roundPda),
  fetchRoundStateRaw(baseConnection, roundPda),
]);
const state = erState && !/^0+$/.test(erState.inputsHash || '') ? erState : baseState;
```

### 4) Commit round state back to base after ER reveal
Commit via ER, then obtain the base‑layer signature from the ER SDK and record both.

```ts
// server/src/solana/tokku-program-service.ts
const erTxHash = await this.sendAndConfirm(this.erConnection, tx, [payer], 'confirmed', true);
const baseTxHash = await GetCommitmentSignature(erTxHash, this.erConnection);
return { erTxHash, baseTxHash };
```

### 5) ER‑based reveal paths (numeric/shape/pattern/entropy/community)
When delegated, use ER reveal variants; otherwise reveal on base with nonce + inputsHash + attestation signature.

```ts
// server/src/features/rounds/rounds.service.ts
revealTxHash = isDelegated
  ? await tokkuProgram.revealOutcomeER(marketPubkey, round.roundNumber, outcome.Numeric.value, adminKeypair)
  : await tokkuProgram.revealOutcome(marketPubkey, round.roundNumber, outcome.Numeric.value, nonce, inputsHash, attestationSig, adminKeypair);
```

#### ER Use Cases Summary
- Low‑latency user betting with ER blockhash and Router submit.
- Round delegation to ER for rapid lock/reveal cycles.
- Preferential ER state observation for VRF inputsHash.
- Post‑reveal anchoring: commit round state from ER back to base layer.
- Robust fallbacks between Router, ER RPC, and base RPC.

---

## Verifiable randomness (VRF): Request + Observe

VRF is requested on ER (or base). The 32‑byte inputsHash is detected by polling ER first.

```ts
// server/src/solana/tokku-program-service.ts
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
    programId: TOKKU_ENGINE_PROGRAM_ID,
    data: Buffer.concat([DISCRIMINATORS.REQUEST_RANDOMNESS, Buffer.from([clientSeed & 0xff])]),
  });
  // send via ER or base
}
```

---

## Outcome attestations (TEE)

TEE generates outcomes with VRF randomness (+ chain hash/community seeds). Optional integrity checks and JWT auth are supported. Local fallback is available for development.

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

- Anchor workspace: `contracts/anchor/programs/tokku-engine` (IDL consumed by server)
- TEE utilities crate: `contracts/tee-engine`

Build:
```bash
cd contracts/anchor && anchor build
cd contracts/tee-engine && cargo build
```

---

## Server

Tech: Fastify, TypeScript, MongoDB (Mongoose), Redis, Solana web3.js (with optional ER/VRF integration).

Common scripts:
```bash
cd server
npm install
npm run dev                       # start API
npm run build && npm start        # production

# Utilities
npm run markets:list
npm run markets:create
npm run db:seed:markets
npm run rounds:check
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
MONGODB_URI=mongodb://localhost:27017/tokku
REDIS_URL=redis://localhost:6379

# Solana / ER / TEE
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
TOKKU_ENGINE_PROGRAM_ID=REPLACE_WITH_TOKKU_PROGRAM_ID

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

## Local Development

### Prerequisites

- Node.js >= 20
- MongoDB running locally
- Redis running locally

### Environment

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

### Quick Start

```bash
# Server
cd server && npm i && npm run dev

# Client
cd ../client && npm i && npm run dev
```

---

## Security Notes

- NEVER commit real keys or production secrets.
- Verify program IDs and queue addresses per environment.
- If enabling TEE integrity checks, ensure TEE RPC endpoints are trusted and stable.

