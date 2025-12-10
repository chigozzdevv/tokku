import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import {
  MAGIC_CONTEXT_ID as SDK_MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID as SDK_MAGIC_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  GetCommitmentSignature,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';
import { confirmTransactionHTTP, withRetry } from '@/utils/transaction-confirmation';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { DISCRIMINATORS } from '@/utils/anchor-discriminators';
import { BorshCoder, Idl } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKKU_PROGRAM_ID = new PublicKey(config.TOKKU_ENGINE_PROGRAM_ID);
const DELEGATION_PROGRAM_PK = new PublicKey(config.DELEGATION_PROGRAM_ID);
const MAGIC_PROGRAM_PK = SDK_MAGIC_PROGRAM_ID as unknown as PublicKey;
const MAGIC_CONTEXT_PK = SDK_MAGIC_CONTEXT_ID as unknown as PublicKey;
const VRF_PROGRAM_PK = new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz');
const [PROGRAM_IDENTITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('identity')],
  TOKKU_PROGRAM_ID,
);
const VRF_DEFAULT_QUEUE_PK = new PublicKey('Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh');

const MARKET_SEED = Buffer.from('market');
const ROUND_SEED = Buffer.from('round');
const VAULT_SEED = Buffer.from('vault');
const BET_SEED = Buffer.from('bet');

export class TokkuProgramService {
  private connection: Connection;
  private erConnection: Connection;
  private routerConnection?: ConnectionMagicRouter;
  private coder: BorshCoder;
  constructor() {
    this.connection = new Connection(config.SOLANA_RPC_URL);
    this.erConnection = new Connection(config.EPHEMERAL_RPC_URL);
    try {
      const routerUrl = this.getRouterUrl(config.EPHEMERAL_RPC_URL);
      this.routerConnection = new ConnectionMagicRouter(routerUrl, {
        commitment: 'confirmed',
        httpHeaders: { 'Content-Type': 'application/json' },
        fetch: (url: any, options?: any) => {
          return fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
        }
      } as any);
    } catch {}
    let idl: Idl;
    const primaryIdlPath = path.resolve(__dirname, '../../../contracts/anchor/target/idl/tokku_engine.json');
    try {
      idl = JSON.parse(fs.readFileSync(primaryIdlPath, 'utf8')) as Idl;
    } catch {
      const fallbackIdlPath = path.resolve(__dirname, '../idl/tokku_engine.json');
      idl = JSON.parse(fs.readFileSync(fallbackIdlPath, 'utf8')) as Idl;
    }
    this.coder = new BorshCoder(idl as any);

    const configuredQueue = new PublicKey(config.VRF_ORACLE_QUEUE);
    if (!configuredQueue.equals(VRF_DEFAULT_QUEUE_PK)) {
      logger.warn(
        {
          configured: configuredQueue.toBase58(),
          expected: VRF_DEFAULT_QUEUE_PK.toBase58(),
        },
        'VRF oracle queue differs from MagicBlock default; ensure this queue is valid for VRF requests',
      );
    }
  }

  private async sendAndConfirm(
    conn: Connection,
    tx: Transaction,
    signers: Keypair[],
    commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
    skipPreflight = false
  ): Promise<string> {
    tx.sign(...signers);
    const rawTx = tx.serialize();
    const signature = await conn.sendRawTransaction(rawTx, { skipPreflight });
    await confirmTransactionHTTP(conn, signature, commitment);
    return signature;
  }

  private getRouterUrl(url: string): string {
    if (/router\.magicblock\.app/.test(url)) return url;
    if (/devnet\.magicblock\.app/.test(url)) return 'https://devnet-router.magicblock.app';
    if (/mainnet\.magicblock\.app/.test(url)) return 'https://mainnet-router.magicblock.app';
    return url;
  }

  async setHouseEdgeBps(
    marketId: PublicKey,
    houseEdgeBps: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const data = Buffer.concat([
      DISCRIMINATORS.SET_HOUSE_EDGE_BPS,
      Buffer.from(new Uint16Array([houseEdgeBps]).buffer),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    const tx = new Transaction().add(ix);
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;
    return this.sendAndConfirm(this.connection, tx, [adminKeypair], 'confirmed');
  }

  async placeBet(
    userPublicKey: PublicKey,
    marketId: PublicKey,
    roundNumber: number,
    selection: { kind: number; a: number; b: number; c: number },
    stakeAmount: number,
    mint: PublicKey,
    opts?: { useER?: boolean }
  ): Promise<{ transaction: Transaction; betPda: PublicKey }> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, marketId.toBuffer()],
      TOKKU_PROGRAM_ID
    );

    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, roundPda.toBuffer(), userPublicKey.toBuffer()],
      TOKKU_PROGRAM_ID
    );

    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      userPublicKey
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(
      mint,
      vaultPda,
      true
    );

    const placeBetData = (() => {
      const stakeBuf = Buffer.alloc(8);
      stakeBuf.writeBigUInt64LE(BigInt(stakeAmount));
      const selBuf = Buffer.alloc(1 + 2 + 2 + 2);
      selBuf.writeUInt8(selection.kind & 0xff, 0);
      selBuf.writeUInt16LE(selection.a & 0xffff, 1);
      selBuf.writeUInt16LE(selection.b & 0xffff, 3);
      selBuf.writeUInt16LE(selection.c & 0xffff, 5);
      return Buffer.concat([
        DISCRIMINATORS.PLACE_BET,
        selBuf,
        stakeBuf,
      ]);
    })();

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: userPublicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: betPda, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: false },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOKKU_PROGRAM_ID,
      data: placeBetData,
    });

    const ixs: TransactionInstruction[] = [];

    const [userAtaInfo, vaultAtaInfo] = await Promise.all([
      this.connection.getAccountInfo(userTokenAccount),
      this.connection.getAccountInfo(vaultTokenAccount),
    ]);

    if (!opts?.useER) {
      if (!userAtaInfo) {
        ixs.push(
          createAssociatedTokenAccountInstruction(
            userPublicKey,
            userTokenAccount,
            userPublicKey,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          )
        );
      }

      if (!vaultAtaInfo) {
        ixs.push(
          createAssociatedTokenAccountInstruction(
            userPublicKey,
            vaultTokenAccount,
            vaultPda,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          )
        );
      }

      const isNative = mint.equals(NATIVE_MINT);
      if (isNative) {
        ixs.push(
          SystemProgram.transfer({ fromPubkey: userPublicKey, toPubkey: userTokenAccount, lamports: stakeAmount })
        );
        ixs.push(createSyncNativeInstruction(userTokenAccount));
      }
    }

    const transaction = new Transaction().add(...ixs, instruction);
    const useER = Boolean(opts?.useER);
    const blockhashInfo = useER
      ? await this.getErBlockhashForTransaction(transaction)
      : await this.getBaseBlockhash();

    transaction.recentBlockhash = blockhashInfo.blockhash;
    if (blockhashInfo.lastValidBlockHeight !== undefined) {
      (transaction as any).lastValidBlockHeight = blockhashInfo.lastValidBlockHeight;
    }
    transaction.feePayer = userPublicKey;

    return { transaction, betPda };
  }

  private async getBaseBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const maxAttempts = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.connection.getLatestBlockhash();
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || '');
        if (msg.includes('fetch failed') || msg.includes('UND_ERR_CONNECT_TIMEOUT')) {
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    logger.error({ lastError }, 'Failed to fetch base layer blockhash');
    throw lastError || new Error('Failed to fetch base layer blockhash');
  }

  private async getErBlockhashForTransaction(
    tx: Transaction
  ): Promise<{ blockhash: string; lastValidBlockHeight?: number }> {
    if (this.routerConnection) {
      try {
        const routerBlockhash = await this.routerConnection.getLatestBlockhashForTransaction(tx);
        if (routerBlockhash?.blockhash) {
          (tx as any).__mb_blockhash_source = 'router';
          return routerBlockhash;
        }
      } catch (routerErr: any) {
        logger.warn(
          { error: routerErr instanceof Error ? routerErr.message : String(routerErr) },
          'Magic Router blockhash fetch failed; falling back to ER RPC'
        );
      }
    }

    const maxAttempts = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await this.erConnection.getLatestBlockhash();
        (tx as any).__mb_blockhash_source = 'er';
        return res;
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || '');
        if (msg.includes('fetch failed') || msg.includes('UND_ERR_CONNECT_TIMEOUT') || msg.includes('ECONNRESET')) {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    logger.error({ lastError }, 'Failed to fetch ER blockhash');
    throw lastError || new Error('Failed to fetch ER blockhash');
  }

  async settleBet(
    marketId: PublicKey,
    roundNumber: number,
    userPublicKey: PublicKey,
    mint: PublicKey,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    // Bet PDA: [BET_SEED, round.key(), user.key()]
    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, roundPda.toBuffer(), userPublicKey.toBuffer()],
      TOKKU_PROGRAM_ID
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, marketId.toBuffer()],
      TOKKU_PROGRAM_ID
    );

    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      userPublicKey
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(
      mint,
      vaultPda,
      true
    );

    const settleBetData = Buffer.from(DISCRIMINATORS.SETTLE_BET);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: betPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: false },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: userPublicKey, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOKKU_PROGRAM_ID,
      data: settleBetData,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.sendAndConfirm(this.connection, transaction, [adminKeypair], 'finalized');
    logger.info({ signature, betPda: betPda.toString() }, 'Bet settled on-chain');
    return signature;
  }

  async openRound(
    marketId: PublicKey,
    roundNumber: number,
    adminKeypair: Keypair
  ): Promise<{ signature: string; roundPda: PublicKey }> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const openRoundData = DISCRIMINATORS.OPEN_ROUND;

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: true },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOKKU_PROGRAM_ID,
      data: openRoundData,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.sendAndConfirm(
      this.connection,
      transaction,
      [adminKeypair],
      'finalized'
    );

    logger.info({ signature, roundPda: roundPda.toString() }, 'Round opened on-chain');

    return { signature, roundPda };
  }

  async getMarketState(marketId: PublicKey): Promise<{ lastRound: number; isActive: boolean }> {
    const info = await this.connection.getAccountInfo(marketId);
    if (!info) {
      throw new Error(`Market ${marketId.toBase58()} not initialized on-chain`);
    }

    let decoded: any;
    try {
      decoded = this.coder.accounts.decode('Market', info.data);
    } catch (error) {
      logger.error({ marketId: marketId.toBase58(), error }, 'Failed to decode market account');
      throw error;
    }
    const lastRoundSource = decoded.lastRound ?? decoded.last_round ?? 0;
    const lastRoundValue = typeof lastRoundSource === 'number'
      ? lastRoundSource
      : typeof lastRoundSource?.toNumber === 'function'
        ? lastRoundSource.toNumber()
        : Number(lastRoundSource ?? 0);

    const activeFlag =
      typeof decoded.isActive === 'boolean'
        ? decoded.isActive
        : typeof decoded.is_active === 'boolean'
          ? decoded.is_active
          : Boolean(decoded.isActive ?? decoded.is_active);

    return {
      lastRound: lastRoundValue,
      isActive: activeFlag,
    };
  }

  decodeBetAccount(data: Buffer): any {
    return this.coder.accounts.decode('Bet', data);
  }

  async lockRound(
    marketId: PublicKey,
    roundNumber: number,
    adminKeypair: Keypair,
    opts?: { useER?: boolean }
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const lockRoundData = DISCRIMINATORS.LOCK_ROUND;

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data: lockRoundData,
    });

    if (!opts?.useER) {
      const tx = new Transaction().add(ix);
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      const sig = await this.sendAndConfirm(this.connection, tx, [adminKeypair], 'finalized');
      logger.info({ signature: sig, roundPda: roundPda.toString() }, 'Round locked on-chain');
      return sig;
    }
    try {
      const sig = await this.sendViaRouter(new Transaction().add(ix), [adminKeypair], 'confirmed');
      logger.info({ signature: sig, roundPda: roundPda.toString() }, 'Round locked via router');
      return sig;
    } catch (e: any) {
      const tx = new Transaction().add(ix);
      const { blockhash } = await this.erConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      const sig = await this.sendAndConfirm(this.erConnection, tx, [adminKeypair], 'confirmed', true);
      logger.info({ signature: sig, roundPda: roundPda.toString() }, 'Round locked on ER');
      return sig;
    }
  }

  async settleRound(
    marketId: PublicKey,
    roundNumber: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const data = DISCRIMINATORS.SETTLE_ROUND;

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    return this.sendAndConfirm(
      this.connection,
      transaction,
      [adminKeypair],
      'finalized'
    );
  }

  async commitOutcomeHash(
    marketId: PublicKey,
    roundNumber: number,
    commitmentHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair,
    opts?: { useER?: boolean }
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.COMMIT_OUTCOME_HASH,
      commitmentHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    const useER = Boolean(opts?.useER);
    const conn = useER ? this.erConnection : this.connection;
    const commitment = useER ? 'confirmed' : 'finalized';
    const skipPreflight = useER;

    if (!useER) {
      const tx = new Transaction().add(instruction);
      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      return this.sendAndConfirm(conn, tx, [adminKeypair], commitment, skipPreflight);
    }
    try {
      return await this.sendViaRouter(new Transaction().add(instruction), [adminKeypair], 'confirmed');
    } catch (routerErr) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const tx = new Transaction().add(instruction);
          const { blockhash } = await conn.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = adminKeypair.publicKey;
          return await this.sendAndConfirm(conn, tx, [adminKeypair], commitment, skipPreflight);
        } catch (error: any) {
          lastError = error;
          const message = String(error?.message || '');
          if (!/Blockhash not found|fetch failed|UND_ERR_CONNECT_TIMEOUT|403|channel closed|PubsubClientError|Remote account provider error/i.test(message)) {
            throw error;
          }
          if (attempt < 2) {
            await this.sleep(400 * (attempt + 1));
            continue;
          }
        }
      }
      throw lastError as any;
    }
  }

  async revealOutcome(
    marketId: PublicKey,
    roundNumber: number,
    value: number,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_NUMERIC,
      Buffer.from(new Uint16Array([value]).buffer),
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.sendAndConfirm(this.connection, transaction, [adminKeypair], 'finalized');
    logger.info({ signature, roundPda: roundPda.toString(), value }, 'Outcome revealed on-chain');
    return signature;
  }

  async revealShapeOutcome(
    marketId: PublicKey,
    roundNumber: number,
    shape: number,
    color: number,
    size: number,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_SHAPE,
      Buffer.from([shape, color, size]),
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.sendAndConfirm(
      this.connection,
      transaction,
      [adminKeypair],
      'finalized'
    );

    logger.info({ signature, roundPda: roundPda.toString(), shape, color, size }, 'Shape outcome revealed');

    return signature;
  }

  async revealPatternOutcome(
    marketId: PublicKey,
    roundNumber: number,
    patternId: number,
    matchedValue: number,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_PATTERN,
      Buffer.from([patternId & 0xff]),
      Buffer.from(new Uint16Array([matchedValue]).buffer),
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.sendAndConfirm(
      this.connection,
      transaction,
      [adminKeypair],
      'finalized'
    );

    logger.info({ signature, roundPda: roundPda.toString(), patternId, matchedValue }, 'Pattern outcome revealed');

    return signature;
  }

  async revealOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    value: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_NUMERIC,
      Buffer.from(new Uint16Array([value]).buffer),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    try {
      const { blockhash } = await this.erConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      const sig = await this.sendAndConfirm(
        this.erConnection,
        tx,
        [adminKeypair],
        'confirmed',
        true
      );
      return sig;
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (!this.routerConnection || !(/Blockhash not found|fetch failed|UND_ERR_CONNECT_TIMEOUT|403|cannot be written/i.test(msg))) {
        throw e;
      }
      const sig = await this.sendViaRouter(new Transaction().add(ix), [adminKeypair], 'confirmed');
      return sig;
    }
  }

  async revealShapeOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    shape: number,
    color: number,
    size: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_SHAPE,
      Buffer.from([shape & 0xff, color & 0xff, size & 0xff]),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    try {
      const { blockhash } = await this.erConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      const sig = await this.sendAndConfirm(
        this.erConnection,
        tx,
        [adminKeypair],
        'confirmed',
        true
      );
      return sig;
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (!this.routerConnection || !(/Blockhash not found|fetch failed|UND_ERR_CONNECT_TIMEOUT|403|cannot be written/i.test(msg))) {
        throw e;
      }
      const sig = await this.sendViaRouter(new Transaction().add(ix), [adminKeypair], 'confirmed');
      return sig;
    }
  }

  async revealPatternOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    patternId: number,
    matchedValue: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_PATTERN,
      Buffer.from([patternId & 0xff]),
      Buffer.from(new Uint16Array([matchedValue]).buffer),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    try {
      const { blockhash } = await this.erConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      const sig = await this.sendAndConfirm(
        this.erConnection,
        tx,
        [adminKeypair],
        'confirmed',
        true
      );
      return sig;
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (!this.routerConnection || !(/Blockhash not found|fetch failed|UND_ERR_CONNECT_TIMEOUT|403|cannot be written/i.test(msg))) {
        throw e;
      }
      const sig = await this.sendViaRouter(new Transaction().add(ix), [adminKeypair], 'confirmed');
      return sig;
    }
  }

  async revealEntropyOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    teeScore: number,
    chainScore: number,
    sensorScore: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_ENTROPY,
      Buffer.from(new Uint16Array([teeScore]).buffer),
      Buffer.from(new Uint16Array([chainScore]).buffer),
      Buffer.from(new Uint16Array([sensorScore]).buffer),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    try {
      const { blockhash } = await this.erConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      const sig = await this.sendAndConfirm(
        this.erConnection,
        tx,
        [adminKeypair],
        'confirmed',
        true
      );
      return sig;
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (!this.routerConnection || !(/Blockhash not found|fetch failed|UND_ERR_CONNECT_TIMEOUT|403|cannot be written/i.test(msg))) {
        throw e;
      }
      const sig = await this.sendViaRouter(new Transaction().add(ix), [adminKeypair], 'confirmed');
      return sig;
    }
  }

  async revealCommunityOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    finalByte: number,
    seedHash: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_COMMUNITY,
      Buffer.from([finalByte & 0xff]),
      seedHash,
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    try {
      const { blockhash } = await this.erConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      const sig = await this.sendAndConfirm(
        this.erConnection,
        tx,
        [adminKeypair],
        'confirmed',
        true
      );
      return sig;
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (!this.routerConnection || !(/Blockhash not found|fetch failed|UND_ERR_CONNECT_TIMEOUT|403|cannot be written/i.test(msg))) {
        throw e;
      }
      const sig = await this.sendViaRouter(new Transaction().add(ix), [adminKeypair], 'confirmed');
      return sig;
    }
  }

  async requestRandomnessER(
    marketId: PublicKey,
    roundNumber: number,
    clientSeed: number,
    payer: Keypair,
    oracleQueue: PublicKey,
    opts?: { useER?: boolean },
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.REQUEST_RANDOMNESS,
      Buffer.from([clientSeed & 0xff]),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: oracleQueue, isSigner: false, isWritable: true },
        { pubkey: PROGRAM_IDENTITY_PDA, isSigner: false, isWritable: false },
        { pubkey: VRF_PROGRAM_PK, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });
    const useER = Boolean(opts?.useER);
    const conn = useER ? this.erConnection : this.connection;
    const tx = new Transaction().add(ix);
    try {
      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      const sig = await this.sendAndConfirm(
        conn,
        tx,
        [payer],
        'confirmed',
        true
      );
      return sig;
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (!useER || !this.routerConnection || !(/Blockhash not found|fetch failed|UND_ERR_CONNECT_TIMEOUT|403|cannot be written/i.test(msg))) {
        throw e;
      }
      const sig = await this.sendViaRouter(new Transaction().add(ix), [payer], 'confirmed');
      return sig;
    }
  }

  async commitRoundStateER(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<{ erTxHash: string; baseTxHash: string }> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );
    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketId, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_PK, isSigner: false, isWritable: true },
    ];
    const ix = new TransactionInstruction({ keys, programId: TOKKU_PROGRAM_ID, data: DISCRIMINATORS.COMMIT_ROUND });
    if (this.routerConnection) {
      try {
        const sig = await this.sendViaRouter(new Transaction().add(ix), [payer], 'confirmed');
        return { erTxHash: sig, baseTxHash: sig };
      } catch {}
    }

    const tx = new Transaction().add(ix);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    const erTxHash = await this.sendAndConfirm(
      this.erConnection,
      tx,
      [payer],
      'confirmed',
      true
    );

    logger.info({ erTxHash, roundPda: roundPda.toString() }, 'Commit sent on ER');

    const baseTxHash = await GetCommitmentSignature(erTxHash, this.erConnection);

    logger.info({ baseTxHash, roundPda: roundPda.toString() }, 'Commit confirmed on base layer');

    return { erTxHash, baseTxHash };
  }

  async commitAndUndelegateRoundER(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<{ erTxHash: string; baseTxHash: string }> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );
    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketId, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_PK, isSigner: false, isWritable: true },
    ];
    const ix = new TransactionInstruction({ keys, programId: TOKKU_PROGRAM_ID, data: DISCRIMINATORS.COMMIT_AND_UNDELEGATE_ROUND });

    if (this.routerConnection) {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const sig = await this.sendViaRouter(new Transaction().add(ix), [payer], 'confirmed');
          return { erTxHash: sig, baseTxHash: sig };
        } catch (err) {
          lastErr = err;
          await this.sleep(400 * (attempt + 1));
        }
      }
    }

    const tx = new Transaction().add(ix);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    const erTxHash = await this.sendAndConfirm(
      this.erConnection,
      tx,
      [payer],
      'confirmed',
      true
    );

    logger.info({ erTxHash, roundPda: roundPda.toString() }, 'Commit and undelegate sent on ER');

    const baseTxHash = await GetCommitmentSignature(erTxHash, this.erConnection);

    logger.info({ baseTxHash, roundPda: roundPda.toString() }, 'Undelegate confirmed on base layer');

    return { erTxHash, baseTxHash };
  }

  async revealEntropyOutcome(
    marketId: PublicKey,
    roundNumber: number,
    teeScore: number,
    chainScore: number,
    sensorScore: number,
    winner: number,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_ENTROPY,
      Buffer.from(new Uint16Array([teeScore]).buffer),
      Buffer.from(new Uint16Array([chainScore]).buffer),
      Buffer.from(new Uint16Array([sensorScore]).buffer),
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.sendAndConfirm(
      this.connection,
      transaction,
      [adminKeypair],
      'finalized'
    );

    logger.info({ signature, roundPda: roundPda.toString(), winner }, 'Entropy outcome revealed');

    return signature;
  }

  async revealCommunityOutcome(
    marketId: PublicKey,
    roundNumber: number,
    finalByte: number,
    seedHash: Buffer,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_COMMUNITY,
      Buffer.from([finalByte]),
      seedHash,
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.sendAndConfirm(
      this.connection,
      transaction,
      [adminKeypair],
      'finalized'
    );

    logger.info({ signature, roundPda: roundPda.toString(), finalByte }, 'Community outcome revealed');

    return signature;
  }

  async delegateRound(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair,
    validatorPubkey?: PublicKey
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    await this.waitForAccountInitialization(roundPda);

    const bufferPda = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(roundPda, TOKKU_PROGRAM_ID);
    const delegationRecordPda = delegationRecordPdaFromDelegatedAccount(roundPda);
    const delegationMetadataPda = delegationMetadataPdaFromDelegatedAccount(roundPda);

    const data = DISCRIMINATORS.DELEGATE_ROUND;

    const attemptDelegate = async () => {
      const keys = [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: bufferPda, isSigner: false, isWritable: true },
        { pubkey: delegationRecordPda, isSigner: false, isWritable: true },
        { pubkey: delegationMetadataPda, isSigner: false, isWritable: true },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: TOKKU_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: DELEGATION_PROGRAM_PK, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ...(validatorPubkey ? [{ pubkey: validatorPubkey, isSigner: false, isWritable: false }] : []),
      ];

      const instruction = new TransactionInstruction({
        keys,
        programId: TOKKU_PROGRAM_ID,
        data,
      });

      const transaction = new Transaction().add(instruction);
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = payer.publicKey;

      const signature = await this.sendAndConfirm(
        this.connection,
        transaction,
        [payer],
        'finalized'
      );

      logger.info({ signature, roundPda: roundPda.toString() }, 'Round delegated');

      return signature;
    };

    const maxAttempts = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          await this.sleep(1000 * attempt);
          await this.waitForAccountInitialization(roundPda);
        }
        return await attemptDelegate();
      } catch (err: any) {
        const message = String(err?.message || '');
        if (
          message.includes('AccountNotInitialized') ||
          message.includes('not initialized on-chain') ||
          message.includes('AccountOwnedByWrongProgram') ||
          message.includes('0xbc4') ||
          message.includes('0xbbf')
        ) {
          lastError = err;
          logger.warn({ attempt, roundPda: roundPda.toString(), error: message }, 'Delegation attempt failed, retrying');
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async ensureRoundUndelegated(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<void> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const account = await this.connection.getAccountInfo(roundPda, 'finalized');
    if (account && account.owner.equals(TOKKU_PROGRAM_ID)) {
      return;
    }

    await this.commitAndUndelegateRoundER(marketId, roundNumber, payer);

    for (let attempt = 0; attempt < 6; attempt++) {
      const info = await this.connection.getAccountInfo(roundPda, 'finalized');
      if (info && info.owner.equals(TOKKU_PROGRAM_ID) && info.data.length > 0) {
        return;
      }
      await this.sleep(500 * (attempt + 1));
    }

    throw new Error(`Round account ${roundPda.toBase58()} is still delegated after commit/undelegate`);
  }

  private async waitForAccountInitialization(
    pubkey: PublicKey,
    timeoutMs = 60000,
    intervalMs = 1500
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await this.connection.getAccountInfo(pubkey, 'finalized');
      if (info && info.data.length > 0 && info.owner.equals(TOKKU_PROGRAM_ID)) {
        logger.info({ pubkey: pubkey.toString(), owner: info.owner.toString() }, 'Account initialized');
        return;
      }
      if (info) {
        logger.debug({
          pubkey: pubkey.toString(),
          owner: info.owner.toString(),
          dataLength: info.data.length
        }, 'Waiting for account initialization');
      }
      await this.sleep(intervalMs);
    }
    throw new Error(`Account ${pubkey.toBase58()} not initialized on-chain`);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async confirmWithHttpOnly(
    connection: Connection,
    signature: string,
    commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
    timeoutMs = 45000,
    pollMs = 1000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const statuses = await connection.getSignatureStatuses([signature]);
      const status = statuses.value[0];
      if (status && status.confirmationStatus) {
        if (commitment === 'finalized') {
          if (status.confirmationStatus === 'finalized') return;
        } else if (commitment === 'confirmed') {
          if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return;
        } else {
          return;
        }
      }
      await this.sleep(pollMs);
    }
    throw new Error(`Transaction ${signature} not confirmed within ${timeoutMs}ms`);
  }

  private async sendViaRouter(
    tx: Transaction,
    signers: Keypair[],
    commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
  ): Promise<string> {
    if (!this.routerConnection) {
      throw new Error('Magic Router unavailable');
    }
    const { blockhash, lastValidBlockHeight } = await (this.routerConnection as any).getLatestBlockhashForTransaction(tx);
    const [firstSigner] = signers;
    tx.recentBlockhash = blockhash;
    (tx as any).lastValidBlockHeight = lastValidBlockHeight;
    if (!tx.feePayer) {
      if (!firstSigner) {
        throw new Error('No signers available to set fee payer');
      }
      tx.feePayer = firstSigner.publicKey;
    }
    tx.partialSign(...signers);
    const raw = tx.serialize();
    const sig = await this.routerConnection.sendRawTransaction(raw, {
      skipPreflight: true,
      preflightCommitment: commitment,
    } as any);
    await this.confirmWithHttpOnly(this.routerConnection, sig, commitment);
    return sig;
  }

  async commitRoundState(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketId, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_PK, isSigner: false, isWritable: true },
    ];

    const data = DISCRIMINATORS.COMMIT_ROUND;

    const instruction = new TransactionInstruction({
      keys,
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    if (this.routerConnection) {
      try {
        const sig = await this.sendViaRouter(new Transaction().add(instruction), [payer], 'confirmed');
        logger.info({ signature: sig, roundPda: roundPda.toString() }, 'Round state committed via router');
        return sig;
      } catch {}
    }

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer.publicKey;
    const sig = await this.sendAndConfirm(
      this.erConnection,
      transaction,
      [payer],
      'confirmed',
      true
    );
    logger.info({ signature: sig, roundPda: roundPda.toString() }, 'Round state committed');
    return sig;
  }

  async commitAndUndelegateRound(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );

    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketId, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_PK, isSigner: false, isWritable: true },
    ];

    const data = DISCRIMINATORS.COMMIT_AND_UNDELEGATE_ROUND;

    const instruction = new TransactionInstruction({
      keys,
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    // Try ER first, then fallback to Magic Router
    try {
      const transaction = new Transaction().add(instruction);
      const { blockhash} = await this.erConnection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = payer.publicKey;
      const sig = await this.sendAndConfirm(
        this.erConnection,
        transaction,
        [payer],
        'confirmed',
        true
      );
      logger.info({ signature: sig, roundPda: roundPda.toString() }, 'Round committed and undelegated');
      return sig;
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (!this.routerConnection || !(/Blockhash not found|fetch failed|UND_ERR_CONNECT_TIMEOUT|403|channel closed|PubsubClientError/i.test(msg))) {
        throw e;
      }
      logger.warn({ roundNumber, error: msg }, 'ER tx failed; falling back to Magic Router');
    }

    if (!this.routerConnection) throw new Error('Magic Router unavailable');
    const sig = await this.sendViaRouter(new Transaction().add(instruction), [payer], 'confirmed');
    logger.info({ signature: sig, roundPda: roundPda.toString() }, 'Round committed and undelegated via router');
    return sig;
  }

  private async getBetCounter(roundPda: PublicKey): Promise<number> {
    try {
      const accountInfo = await this.connection.getAccountInfo(roundPda);
      if (!accountInfo) return 0;

      const data = accountInfo.data;
      const unsettledBets = data.readUInt32LE(8 + 32 + 8 + 1 + 32);
      return unsettledBets;
    } catch {
      return 0;
    }
  }

  async getRoundPda(marketId: PublicKey, roundNumber: number): Promise<PublicKey> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOKKU_PROGRAM_ID
    );
    return roundPda;
  }

  async getMarketPda(adminPublicKey: PublicKey): Promise<PublicKey> {
    const indexBuf = Buffer.alloc(2);
    indexBuf.writeUInt16LE(0, 0);
    const [marketPda] = PublicKey.findProgramAddressSync(
      [MARKET_SEED, adminPublicKey.toBuffer(), indexBuf],
      TOKKU_PROGRAM_ID
    );
    return marketPda;
  }

  async getMarketPdaByIndex(adminPublicKey: PublicKey, index: number): Promise<PublicKey> {
    const indexBuf = Buffer.alloc(2);
    indexBuf.writeUInt16LE(index & 0xffff, 0);
    const [marketPda] = PublicKey.findProgramAddressSync(
      [MARKET_SEED, adminPublicKey.toBuffer(), indexBuf],
      TOKKU_PROGRAM_ID
    );
    return marketPda;
  }

  async initializeMarket(
    adminKeypair: Keypair,
    name: string,
    houseEdgeBps: number,
    marketTypeDiscriminant: number,
    index: number,
    mint: PublicKey,
  ): Promise<{ signature: string; marketPda: PublicKey }> {
    const marketPda = await this.getMarketPdaByIndex(adminKeypair.publicKey, index);
    const idlPath = path.resolve(__dirname, '../../../contracts/anchor/target/idl/tokku_engine.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as Idl;
    const coder = new BorshCoder(idl as any);
    const variant = [
      { PickRange: {} },
      { EvenOdd: {} },
      { LastDigit: {} },
      { ModuloThree: {} },
      { PatternOfDay: {} },
      { ShapeColor: {} },
      { Jackpot: {} },
      { EntropyBattle: {} },
      { StreakMeter: {} },
      { CommunitySeed: {} },
    ][marketTypeDiscriminant] || { PickRange: {} };
    const data = coder.instruction.encode('initialize_market', {
      name,
      house_edge_bps: houseEdgeBps,
      market_type: variant,
      market_index: index,
    });

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOKKU_PROGRAM_ID,
      data,
    });

    const tx = new Transaction().add(ix);
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;
    const sig = await this.sendAndConfirm(
      this.connection,
      tx,
      [adminKeypair],
      'finalized'
    );
    return { signature: sig, marketPda };
  }

  async getBetPda(roundPda: PublicKey, userPublicKey: PublicKey): Promise<PublicKey> {
    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, roundPda.toBuffer(), userPublicKey.toBuffer()],
      TOKKU_PROGRAM_ID
    );
    return betPda;
  }

  async getVaultPda(marketId: PublicKey): Promise<PublicKey> {
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, marketId.toBuffer()],
      TOKKU_PROGRAM_ID
    );
    return vaultPda;
  }
}
