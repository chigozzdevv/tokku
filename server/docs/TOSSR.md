# TOSSR.gg — Bet on Provable Randomness

Tagline: Bet on Provable Randomness

Core concept: TOSSR is a real-time, verifiably fair prediction arcade. Outcomes are generated privately in a Trusted Execution Environment (TEE) via MagicBlock Private Ephemeral Rollups (ER/TEE) and verified on-chain (Solana). Users get the speed of Web2 with the provability of Web3.

## 1. Vision & Philosophy

- Confidential: Outcome generation happens in hardware enclaves (Intel TDX).
- Attested: The enclave signs the result and code measurement.
- Verifiable: A Solana verifier checks the proof before settlement.

No admin, developer, or validator can see or tamper with results pre‑reveal. Every user can audit fairness on-chain.

## 2. Roles

- Player: Places bets, views odds, tracks winnings.
- Spectator: Watches rounds and checks proofs.
- Admin: Curates markets, monitors proofs, manages operations.

## 3. User Flow

1) Enter site → connect wallet (Phantom/Solflare/Glow).  
2) Markets Hub → active markets overview.  
3) Select market → Round View: cards (choices), odds, stake, timer.  
4) Place bet (MagicBlock ER, instant & gasless).  
5) Lock → Reveal → Proof modal + on‑chain link.  
6) Settlement → payout → history/leaderboards update.

Round phases: Predict (60s) → Lock (5–10s) → Reveal (≤2s) → Settle (chain confirmation).

## 4. Markets

Global odds ladder by coverage:

| Coverage | Example | Odds |
| --- | --- | --- |
| ≥ 25% | 1–25 range | 2× |
| 10–25% | 1–10 | 4× |
| 5–10% | shape subsets | 8× |
| 1–5% | rare patterns | 16× |
| 0.5–1% | very rare | 32× |
| < 0.5% | exact hits | 64–90× |

House edge: 2% applied multiplicatively.

### A. Core Random

1) Pick the Range (1–100)  
2) Even/Odd  
3) Last Digit (0–9)  
4) Modulo‑3 (0/1/2)

### B. Pattern‑Based

5) Pattern of the Day (prime, fib, squares, ends with 7)

6) Shape & Color (4 shapes × 6 colors × 3 sizes = 72 outcomes)

### C. Advanced (Provable Computation)

7) Entropy Index Battle: compare entropy of TEE RNG vs Solana blockhash vs sensor feed. Attestation includes sample inputs + entropy scores.  
8) Streak Meter: persistent enclave state tracks per‑wallet streak toward a target (2–4).  
9) Community Seed Round: players submit a byte; enclave aggregates → hash → final seed; winners are closest by Hamming distance.

### D. Premium

10) Jackpot (00–99 exact) — 90× odds, daily/weekly.

## 5. Attestation

TEE outputs: round_id, code_measurement, inputs_hash, output, signature.  
Verifier contract checks: measurement whitelist, inputs, signature.  
On success → emits RoundSettled and pays winners.

Proof modal shows: code_measurement, inputs_hash, outcome, Solana tx link.

## 6. Payout

Reveal → highlight winning cards → on‑chain verification → wallet credited → history and leaderboards update. Jackpot may roll over.

## 7. UX Highlights

- Heatmap of crowd picks.
- Leaderboards (daily/weekly/all‑time).
- XP badges & streak rewards.
- Confetti + proof overlay on reveal.

## 8. Security & Fairness

- RNG inside Intel TDX TEE.  
- Attestation verification on Solana.  
- Lock window prevents last‑second front‑run.  
- Per‑wallet/rate limits.  
- Refunds on verifier failures.  
- Public audit trail for every round.

## 9. Future

- LP markets (AMM), social rooms, DePIN entropy, NFT perks, PWA.

## 10. Architecture (Conceptual)

Client ↔ MagicBlock ER ↔ Private ER (TEE) ↔ Solana Verifier ↔ Payouts/History/Leaderboards

## 11. Glossary

- TEE: Trusted Execution Environment (Intel TDX).  
- Attestation: Signed proof enclave ran trusted code.  
- ER: Ephemeral Rollup for low‑latency, Solana‑compatible execution.  
- PER: Private ER (ER + TEE).  
- Verifier: Solana program validating attestations.

