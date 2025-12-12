import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.string().default("3001"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),

  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),

  SOLANA_RPC_URL: z.string().url(),
  SOLANA_WS_URL: z.string().url(),
  EPHEMERAL_RPC_URL: z.string().url(),
  EPHEMERAL_WS_URL: z.string().url(),

  TEE_RPC_URL: z.string().url(),
  TEE_BACKUP_RPC_URL: z.string().url().optional().default(""),
  TEE_INTEGRITY_REQUIRED: z
    .string()
    .transform((v) => v === "true")
    .default("false" as any),
  VRF_ORACLE_QUEUE: z.string().min(1, "VRF_ORACLE_QUEUE is required"),

  DELEGATION_PROGRAM_ID: z.string().min(1),
  MAGIC_PROGRAM_ID: z.string().min(1),
  MAGIC_CONTEXT_ID: z.string().optional().default(""),
  TEE_PROGRAM_ID: z.string().min(1),
  PERMISSION_PROGRAM_ID: z.string().min(1),
  TOKKU_ENGINE_PROGRAM_ID: z.string().min(1),
  ER_VALIDATOR_PUBKEY: z
    .string()
    .default("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
  TEE_PRIVATE_KEY_HEX: z.string().optional().default(""),

  ADMIN_PRIVATE_KEY: z.string().min(1),

  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  RATE_LIMIT_WINDOW_MS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(60000),
  RATE_LIMIT_MAX_REQUESTS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(100),

  ROUND_DURATION_SECONDS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(60),
  ROUND_RELEASE_INTERVAL_SECONDS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(60),
  ROUND_QUEUE_BUFFER_SECONDS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(15),
  ROUND_RELEASE_POLL_SECONDS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(3),
  LOCK_DURATION_SECONDS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(10),
  JACKPOT_COOLDOWN_HOURS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(24),

  MAX_STREAK_TARGET: z.string().regex(/^\d+$/).transform(Number).default(5),
  STREAK_RESET_ON_LOSS: z
    .string()
    .transform((val) => val === "true")
    .default(true),

  ATTESTATION_CACHE_TTL: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(300),
  TEE_AUTH_CACHE_TTL: z.string().regex(/^\d+$/).transform(Number).default(300),
});

function parseEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    console.error("[ERROR] Invalid environment variables:", error);
    process.exit(1);
  }
}

export const config = parseEnv();

export type Config = typeof config;
