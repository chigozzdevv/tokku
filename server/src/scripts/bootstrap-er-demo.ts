/**
 * Bootstrap an end-to-end Ephemeral Rollup bet:
 *  1. Generates a bettor wallet (saved under tmp/bettor-keypair.json)
 *  2. Airdrops SOL and wraps WSOL if required by the selected market
 *  3. Queues, opens, and delegates a fresh round for the first active market
 *  4. Places a bet through the Magic Router and confirms it in the backend
 *
 * Run with:
 *   npx tsx src/scripts/bootstrap-er-demo.ts
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import mongoose from 'mongoose';
import { connectRedis, redis } from '../config/redis';
import { config as appConfig } from '../config/env';
import { User, Market, Round } from '../config/database';
import { RoundsService } from '../features/rounds/rounds.service';
import { BetsService } from '../features/bets/bets.service';
import { getMarketConfig } from '../utils/market-config';
import { logger } from '../utils/logger';
import { confirmTransactionHTTP } from '../utils/transaction-confirmation';

type Selection =
  | { type: 'single'; value: number }
  | { type: 'range'; min: number; max: number }
  | { type: 'parity'; value: 'even' | 'odd' }
  | { type: 'digit'; value: number }
  | { type: 'modulo'; value: number }
  | { type: 'pattern'; patternId: number }
  | { type: 'shape'; shape: number; color: number; size: number }
  | { type: 'entropy'; source: 'tee' | 'chain' | 'sensor' }
  | { type: 'streak'; target: number }
  | { type: 'community'; byte: number };

const ROUTER_HTTP_URL = 'https://devnet-router.magicblock.app';
const ROUTER_WS_URL = 'wss://devnet-router.magicblock.app';
const WSOL_MINT = NATIVE_MINT.toBase58();
const BET_STAKE_SOL = 0.05; // 0.05 SOL
const WRAP_BUFFER_SOL = 0.05; // extra WSOL to cover bet + margin

async function main() {
  await mongoose.connect(appConfig.MONGODB_URI, { bufferCommands: false });
  logger.info('Connected to MongoDB');

  await connectRedis();

  try {
    const shouldReset = process.env.BOOTSTRAP_RESET === 'true';
    if (shouldReset) {
      const removed = await Round.deleteMany({});
      logger.info({ removed: removed.deletedCount }, 'Cleared existing rounds');
    }

    // 1. Load or generate bettor wallet
    const { bettor, keyPath, created } = loadOrCreateBettorKeypair();
    logger.info(
      { keyPath, publicKey: bettor.publicKey.toBase58(), created },
      created ? 'Generated bettor wallet' : 'Loaded bettor wallet',
    );

    // 2. Pick market & prepare round
    const marketDoc = await Market.findOne({ isActive: true }).lean();
    if (!marketDoc) {
      throw new Error('No active market found. Configure a market first.');
    }

    const marketConfig = getMarketConfig(marketDoc.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    if (!marketConfig.mintAddress) {
      throw new Error('Market config missing mintAddress');
    }
    const mintPubkey = new PublicKey(marketConfig.mintAddress);

    if (mintPubkey.toBase58() !== WSOL_MINT) {
      throw new Error(`Bootstrap script currently supports WSOL markets only. Found mint ${mintPubkey.toBase58()}`);
    }

    const roundsService = new RoundsService();
    const baseConnection = new Connection(appConfig.SOLANA_RPC_URL, 'confirmed');
    const minRequiredLamports = Math.round((BET_STAKE_SOL + WRAP_BUFFER_SOL + 0.05) * LAMPORTS_PER_SOL);
    let currentBalance = await baseConnection.getBalance(bettor.publicKey);
    if (currentBalance < minRequiredLamports) {
      const airdropAmount = Math.max(2 * LAMPORTS_PER_SOL, minRequiredLamports - currentBalance + LAMPORTS_PER_SOL);
      const airdropSig = await requestAirdropWithFallback(bettor.publicKey, airdropAmount);
      if (airdropSig) {
        logger.info({ airdropSig }, `Airdrop complete (${airdropAmount / LAMPORTS_PER_SOL} SOL)`);
        currentBalance = await baseConnection.getBalance(bettor.publicKey);
      } else {
        logger.warn(
          { publicKey: bettor.publicKey.toBase58(), currentBalance, minRequiredLamports },
          'Airdrop failed; ensure wallet is funded before proceeding.',
        );
      }
    }

    if (currentBalance < minRequiredLamports) {
      logger.warn(
        {
          publicKey: bettor.publicKey.toBase58(),
          currentBalanceLamports: currentBalance,
          minRequiredLamports,
        },
        'Insufficient SOL balance. Fund this wallet and rerun the script to place the bet.',
      );
      return;
    }

    const releaseGroupId = `bootstrap-${Date.now()}`;
    const queued = await roundsService.queueRound(String(marketDoc._id), new Date(), releaseGroupId);
    const queuedId = String((queued as any)._id);
    logger.info({ queuedId }, 'Queued round');

    await roundsService.releaseQueuedRound(queuedId);
    let roundDoc = await Round.findById(queuedId).lean();

    if (!roundDoc || roundDoc.status !== 'PREDICTING') {
      throw new Error('Failed to obtain an active predicting round after release');
    }

    logger.info({ roundId: String(roundDoc._id), roundNumber: roundDoc.roundNumber }, 'Active round ready');

    const refreshedRound = await Round.findById(roundDoc._id).lean();
    if (!refreshedRound) {
      throw new Error(`Round ${String(roundDoc._id)} disappeared after delegation`);
    }
    roundDoc = refreshedRound;

    // 4. Create bettor user record
    const existingUser = await User.findOne({ walletAddress: bettor.publicKey.toBase58() }).lean();
    const user = existingUser
      ? existingUser
      : await User.create({ walletAddress: bettor.publicKey.toBase58() });

    // 5. Prepare WSOL ATA if required
    if (mintPubkey.toBase58() === WSOL_MINT) {
      const userAta = await getAssociatedTokenAddress(mintPubkey, bettor.publicKey, false);
      const ataInfo = await baseConnection.getAccountInfo(userAta);
      const wrapLamports = Math.round((BET_STAKE_SOL + WRAP_BUFFER_SOL) * LAMPORTS_PER_SOL);

      const prepTx = new Transaction();
      if (!ataInfo) {
        prepTx.add(
          createAssociatedTokenAccountInstruction(
            bettor.publicKey,
            userAta,
            bettor.publicKey,
            mintPubkey,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
      }

      prepTx.add(
        SystemProgram.transfer({
          fromPubkey: bettor.publicKey,
          toPubkey: userAta,
          lamports: wrapLamports,
        }),
      );
      prepTx.add(createSyncNativeInstruction(userAta));

      prepTx.feePayer = bettor.publicKey;
      const { blockhash } = await baseConnection.getLatestBlockhash();
      prepTx.recentBlockhash = blockhash;
      const prepSig = await baseConnection.sendTransaction(prepTx, [bettor], { skipPreflight: false });
      await baseConnection.confirmTransaction(prepSig, 'confirmed');
      logger.info({ prepSig, userAta: userAta.toBase58(), wrapLamports }, 'WSOL ATA prepared');
    }

    // 6. Build selection sample
    const selection: Selection = buildSelection(String(roundDoc.marketId), (marketDoc as any).type);

    const betsService = new BetsService();
    const stakeLamports = Math.round(BET_STAKE_SOL * LAMPORTS_PER_SOL);

    const roundIdStr = String(roundDoc._id);
    logger.info({ roundId: roundIdStr }, 'Preparing bet transaction');
    const roundSanity = await Round.findById(roundIdStr).lean();
    if (!roundSanity) {
      throw new Error(`Round ${roundIdStr} not found before bet transaction`);
    }

    const payload = await betsService.createBetTransaction(
      String((user as any)._id),
      bettor.publicKey.toBase58(),
      roundIdStr,
      selection,
      stakeLamports,
    );

    const txBytes = Buffer.from(payload.transaction, 'base64');
    const tx = Transaction.from(txBytes);
    tx.feePayer = bettor.publicKey;
    let signature: string;
    const submitUrl: string | undefined = (payload as any).submitRpcUrl;
    if (submitUrl) {
      const erConn = new Connection(submitUrl, 'confirmed');
      const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      (tx as any).lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = bettor.publicKey;
      signature = await sendAndConfirmTransaction(erConn, tx, [bettor], {
        skipPreflight: true,
        commitment: 'confirmed',
      } as any);
      logger.info({ signature }, 'Bet transaction confirmed on ER');
    } else {
      const { blockhash, lastValidBlockHeight } = await baseConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      (tx as any).lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = bettor.publicKey;
      signature = await sendAndConfirmTransaction(baseConnection, tx, [bettor], {
        skipPreflight: true,
        commitment: 'confirmed',
      } as any);
      logger.info({ signature }, 'Bet transaction confirmed on base layer');
    }

    await betsService.confirmBet(
      String(user._id),
      roundIdStr,
      selection,
      stakeLamports,
      signature,
      payload.betPda,
    );

    logger.info({ roundId: roundIdStr }, 'Bet confirmed on base layer');

    logger.info({ roundId: roundIdStr }, 'Locking round');
    const lockSignature = await roundsService.lockRound(roundIdStr);
    logger.info({ roundId: roundIdStr, lockSignature }, 'Round locked');

    logger.info({ roundId: roundIdStr }, 'Revealing outcome');
    await roundsService.revealOutcome(roundIdStr);
    logger.info({ roundId: roundIdStr }, 'Outcome revealed');

    logger.info({ roundId: roundIdStr }, 'Undelegating round for settlement');
    await roundsService.undelegateRound(roundIdStr);
    logger.info({ roundId: roundIdStr }, 'Round undelegated and settlement triggered');

    logger.info(
      {
        bettor: bettor.publicKey.toBase58(),
        keyPairFile: keyPath,
        roundId: roundIdStr,
        betSignature: signature,
        betPda: payload.betPda,
      },
      'Bootstrap complete. Bettor wallet ready for reuse.',
    );
  } finally {
    await mongoose.disconnect();
    if ((redis as any)?.status && (redis as any).status !== 'end') {
      await redis.quit();
    }
  }
}

async function requestAirdropWithFallback(pubkey: PublicKey, lamports: number): Promise<string | null> {
  const endpoints = Array.from(new Set([appConfig.SOLANA_RPC_URL, 'https://api.devnet.solana.com']));
  for (const endpoint of endpoints) {
    try {
      const connection = new Connection(endpoint, 'confirmed');
      const sig = await connection.requestAirdrop(pubkey, lamports);
      await connection.confirmTransaction(sig, 'confirmed');
      return sig;
    } catch (err) {
      logger.warn({ endpoint, err }, 'Airdrop attempt failed');
    }
  }
  return null;
}

async function rpcRequest(endpoint: string, method: string, params: any[]): Promise<any> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
  }
  const body: any = await response.json();
  if (body?.error) {
    throw new Error(`RPC ${method} error: ${JSON.stringify(body.error)}`);
  }
  return body?.result;
}

function getWritableAccounts(tx: Transaction, feePayer?: PublicKey): string[] {
  const set = new Set<string>();
  if (feePayer) set.add(feePayer.toBase58());
  for (const ix of tx.instructions) {
    for (const key of ix.keys) {
      if (key.isWritable) set.add(key.pubkey.toBase58());
    }
  }
  return Array.from(set);
}

async function routerGetBlockhashForAccounts(routerUrl: string, accounts: string[]): Promise<{ blockhash: string; lastValidBlockHeight?: number }> {
  const res = await fetch(routerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockhashForAccounts', params: [accounts] }),
  });
  if (!res.ok) throw new Error(`Router HTTP ${res.status}`);
  const body: any = await res.json();
  if (body?.error) throw new Error(body.error?.message || 'Router error');
  if (!body?.result?.blockhash) throw new Error('Router returned no blockhash');
  return body.result;
}

async function sendTransactionHttp(endpoint: string, rawBase64: string): Promise<string> {
  return rpcRequest(endpoint, 'sendTransaction', [
    rawBase64,
    {
      skipPreflight: true,
      encoding: 'base64',
      commitment: 'confirmed',
    },
  ]);
}

async function confirmSignatureHttp(
  endpoint: string,
  signature: string,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
  timeoutMs = 60000,
  pollIntervalMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statuses = await rpcRequest(endpoint, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
    const status = statuses?.value?.[0];
    if (status) {
      if (status.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }
      const confirmationStatus = status.confirmationStatus;
      if (commitment === 'finalized' && confirmationStatus === 'finalized') return;
      if (commitment === 'confirmed' && (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized')) return;
      if (commitment === 'processed' && confirmationStatus) return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Transaction ${signature} not confirmed within ${timeoutMs}ms`);
}

//

function loadOrCreateBettorKeypair(): { bettor: Keypair; keyPath: string; created: boolean } {
  const envPath = process.env.BETTOR_KEYPAIR_PATH?.trim();
  const keyPath = envPath
    ? path.isAbsolute(envPath)
      ? envPath
      : path.resolve(process.cwd(), envPath)
    : path.resolve(__dirname, '../../tmp/bettor-demo.json');

  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath, 'utf-8');
    const secret = JSON.parse(raw);
    const bettor = Keypair.fromSecretKey(Uint8Array.from(secret));
    return { bettor, keyPath, created: false };
  }

  const dir = path.dirname(keyPath);
  mkdirSync(dir, { recursive: true });
  const bettor = Keypair.generate();
  writeFileSync(keyPath, JSON.stringify(Array.from(bettor.secretKey), null, 2), { encoding: 'utf-8' });
  return { bettor, keyPath, created: true };
}

function buildSelection(marketId: string, marketType: string): Selection {
  switch (marketType) {
    case 'PICK_RANGE':
      return { type: 'single', value: 7 };
    case 'EVEN_ODD':
      return { type: 'parity', value: 'even' };
    case 'LAST_DIGIT':
      return { type: 'digit', value: 3 };
    case 'MODULO_THREE':
      return { type: 'modulo', value: 1 };
    case 'PATTERN_OF_DAY':
      return { type: 'pattern', patternId: 0 };
    case 'SHAPE_COLOR':
      return { type: 'shape', shape: 0, color: 0, size: 0 };
    case 'ENTROPY_BATTLE':
      return { type: 'entropy', source: 'tee' };
    case 'STREAK_METER':
      return { type: 'streak', target: 2 };
    case 'COMMUNITY_SEED':
      return { type: 'community', byte: 1 };
    default:
      logger.warn({ marketId, marketType }, 'Unknown market type encountered; defaulting to single 1');
      return { type: 'single', value: 1 };
  }
}

main().catch((err) => {
  logger.error({ err }, 'Bootstrap script failed');
  process.exit(1);
});
