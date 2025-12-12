import "dotenv/config";
import { connectDatabase, disconnectDatabase, Market } from "@/config/database";
import { getAdminKeypair } from "@/config/admin-keypair";
import { getMarketConfig } from "@/utils/market-config";
import { config as appConfig } from "@/config/env";
import { logger } from "@/utils/logger";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  Connection,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

const VAULT_SEED = Buffer.from("vault");

async function fundVaultForMarket(
  connection: Connection,
  admin: ReturnType<typeof getAdminKeypair>,
  marketPk: PublicKey,
  mintPk: PublicKey,
  targetLamports: number,
): Promise<void> {
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, marketPk.toBuffer()],
    new PublicKey(appConfig.TOKKU_ENGINE_PROGRAM_ID),
  );

  const adminToken = await getAssociatedTokenAddress(
    mintPk,
    admin.publicKey,
    false,
  );
  const vaultToken = await getAssociatedTokenAddress(mintPk, vaultPda, true);

  const [adminTokenInfo, vaultTokenInfo] = await Promise.all([
    connection.getAccountInfo(adminToken),
    connection.getAccountInfo(vaultToken),
  ]);

  const ixs: any[] = [];

  if (!adminTokenInfo) {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        adminToken,
        admin.publicKey,
        mintPk,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  if (!vaultTokenInfo) {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        vaultToken,
        vaultPda,
        mintPk,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  const vaultBalanceRes = vaultTokenInfo
    ? await connection.getTokenAccountBalance(vaultToken)
    : null;
  const currentVaultAmount = vaultBalanceRes?.value?.amount
    ? BigInt(vaultBalanceRes.value.amount)
    : 0n;

  const targetAmount = BigInt(targetLamports);
  if (currentVaultAmount >= targetAmount) {
    logger.info(
      {
        market: marketPk.toBase58(),
        currentVaultAmount: currentVaultAmount.toString(),
      },
      "Vault already funded to target or above; skipping",
    );
    return;
  }

  const delta = targetAmount - currentVaultAmount;

  const adminBalanceRes = adminTokenInfo
    ? await connection.getTokenAccountBalance(adminToken)
    : null;
  const currentAdminAmount = adminBalanceRes?.value?.amount
    ? BigInt(adminBalanceRes.value.amount)
    : 0n;

  const neededForAdmin =
    delta > currentAdminAmount ? delta - currentAdminAmount : 0n;

  if (neededForAdmin > 0n) {
    const neededNumber = Number(neededForAdmin);
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: adminToken,
        lamports: neededNumber,
      }),
    );
    ixs.push(createSyncNativeInstruction(adminToken));
  }

  const deltaNumber = Number(delta);
  const decimals = 9;

  ixs.push(
    createTransferCheckedInstruction(
      adminToken,
      mintPk,
      vaultToken,
      admin.publicKey,
      deltaNumber,
      decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const tx = new Transaction().add(...ixs);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = admin.publicKey;

  const signature = await connection.sendTransaction(tx, [admin], {
    skipPreflight: false,
  });
  await connection.confirmTransaction(signature, "confirmed");

  logger.info(
    { market: marketPk.toBase58(), signature, delta: deltaNumber },
    "Vault funding transaction confirmed",
  );
}

async function main() {
  await connectDatabase();
  logger.info("Connected to MongoDB");

  const admin = getAdminKeypair();
  logger.info(
    { admin: admin.publicKey.toBase58() },
    "Loaded admin keypair for vault funding",
  );

  const connection = new Connection(appConfig.SOLANA_RPC_URL, "confirmed");

  const markets = await Market.find({ isActive: true }).lean();
  logger.info({ count: markets.length }, "Found active markets to fund");

  const targetLamports = 4 * LAMPORTS_PER_SOL;

  for (const m of markets as any[]) {
    const cfg = getMarketConfig(m.config as unknown);
    if (!cfg.solanaAddress || !cfg.mintAddress) {
      logger.warn(
        { id: String(m._id), name: m.name },
        "Skipping market with missing solanaAddress or mintAddress",
      );
      continue;
    }

    const marketPk = new PublicKey(cfg.solanaAddress);
    const mintPk = new PublicKey(cfg.mintAddress);

    logger.info(
      { id: String(m._id), name: m.name, market: marketPk.toBase58() },
      "Ensuring vault has 4 SOL",
    );

    await fundVaultForMarket(
      connection,
      admin,
      marketPk,
      mintPk,
      targetLamports,
    );
  }

  await disconnectDatabase();
  logger.info("Disconnected from MongoDB");
}

main().catch((err) => {
  logger.error({ err }, "fund-all-vaults script failed");
  console.error(err);
  process.exit(1);
});
