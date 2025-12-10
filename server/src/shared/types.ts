import { z } from 'zod';

export enum RoundStatus {
  QUEUED = 'QUEUED',
  PREDICTING = 'PREDICTING',
  LOCKED = 'LOCKED',
  REVEALED = 'REVEALED',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
}
export type RoundStatusType = `${RoundStatus}`;

// Common response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// User types
export interface AuthUser {
  id: string;
  walletAddress: string;
}

export interface JwtPayload {
  userId: string;
  walletAddress: string;
  iat?: number;
  exp?: number;
}

// Market types
export enum MarketType {
  PICK_RANGE = 'PICK_RANGE',
  EVEN_ODD = 'EVEN_ODD',
  LAST_DIGIT = 'LAST_DIGIT',
  MODULO_THREE = 'MODULO_THREE',
  PATTERN_OF_DAY = 'PATTERN_OF_DAY',
  SHAPE_COLOR = 'SHAPE_COLOR',
  JACKPOT = 'JACKPOT',
  ENTROPY_BATTLE = 'ENTROPY_BATTLE',
  STREAK_METER = 'STREAK_METER',
  COMMUNITY_SEED = 'COMMUNITY_SEED',
}

export enum BetStatus {
  PENDING = 'PENDING',
  WON = 'WON',
  LOST = 'LOST',
  REFUNDED = 'REFUNDED',
}

export enum StreakStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// Bet selection types
export type BetSelection = 
  | { type: 'range'; min: number; max: number }
  | { type: 'single'; value: number }
  | { type: 'parity'; value: 'even' | 'odd' }
  | { type: 'digit'; value: number }
  | { type: 'modulo'; value: number }
  | { type: 'pattern'; patternId: string }
  | { type: 'shape'; shape: string; color?: string; size?: string }
  | { type: 'entropy'; source: string; comparison: '>' | '<' | '=' }
  | { type: 'streak'; target: number }
  | { type: 'community'; byte: number };

// Result types
export interface RoundResult {
  type: MarketType;
  outcome: any;
  processedAt: string;
}

export interface EntropyResult {
  tee: number;
  chain: number;
  sensor: number;
  winner: string;
}

// Attestation types
export interface AttestationData {
  roundId: string;
  result: RoundResult;
  entropy?: EntropyResult;
  inputsHash: string;
  codeMeasurement: string;
  signature: string;
  verifiedAt?: string;
  txHash?: string;
}

// Blockchain integration
export interface SolanaConfig {
  rpcUrl: string;
  wsUrl: string;
  programs: {
    delegation: string;
    magic: string;
    tee: string;
  };
}

export interface EphemeralConfig {
  rpcUrl: string;
  wsUrl: string;
}

export interface TeeConfig {
  rpcUrl: string;
  attestationEndpoint?: string;
}
