import { createHash, randomBytes } from 'crypto';
import { signAsync, getPublicKey } from '@noble/secp256k1';

export type TeeMarketType =
  | 'PickRange'
  | 'EvenOdd'
  | 'LastDigit'
  | 'ModuloThree'
  | 'PatternOfDay'
  | 'ShapeColor'
  | 'Jackpot'
  | 'EntropyBattle'
  | 'StreakMeter'
  | 'CommunitySeed';

type Outcome =
  | { Numeric: { value: number } }
  | { Shape: { shape: number; color: number; size: number } }
  | { Pattern: { pattern_id: number; matched_value: number } }
  | { Entropy: { tee_score: number; chain_score: number; sensor_score: number; winner: number } }
  | { Community: { final_byte: number; seed_hash: number[] } };

export interface LocalTeeAttestation {
  round_id: string;
  market_type: TeeMarketType;
  outcome: Outcome;
  commitment_hash: string;
  nonce: string;
  inputs_hash: string;
  code_measurement: string;
  signature: string;
  public_key: string;
  timestamp: number;
  local_fallback: true;
}

class SeededRng {
  private readonly seed: Uint8Array;
  private counter = 0n;

  constructor(seed?: Uint8Array) {
    this.seed = seed ?? randomBytes(32);
  }

  nextBytes(length: number): Buffer {
    const out = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const counterBuf = Buffer.alloc(8);
      counterBuf.writeBigUInt64BE(this.counter++);
      const block = createHash('sha256').update(this.seed).update(counterBuf).digest();
      const remaining = length - offset;
      const chunk = block.subarray(0, remaining);
      chunk.copy(out, offset);
      offset += chunk.length;
    }
    return out;
  }

  nextUint32(): number {
    return this.nextBytes(4).readUInt32LE(0);
  }
}

const CODE_MEASUREMENT_HEX = (() => {
  const digest = createHash('sha256').update('tokku-tee-engine-0.1.0').digest('hex');
  return digest;
})();

const ENC = new TextEncoder();

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  const limit = Math.floor(Math.sqrt(n));
  for (let i = 3; i <= limit; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

const FIB_SET = new Set([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987]);

function isFibonacci(n: number): boolean {
  return FIB_SET.has(n);
}

function isPerfectSquare(n: number): boolean {
  const sqrt = Math.sqrt(n);
  return Number.isInteger(sqrt);
}

function isPalindrome(n: number): boolean {
  const s = String(n);
  return s === s.split('').reverse().join('');
}

function calculateEntropyScore(bytes: Uint8Array): number {
  const freq = new Array<number>(256).fill(0);
  bytes.forEach((b) => {
    freq[b] = (freq[b] ?? 0) + 1;
  });
  const len = bytes.length;
  let entropy = 0;
  for (const count of freq) {
    if (count === 0) continue;
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return Math.floor(entropy * 125);
}

function determineEntropyWinner(tee: number, chain: number, sensor: number): number {
  if (tee >= chain && tee >= sensor) return 0;
  if (chain >= tee && chain >= sensor) return 1;
  return 2;
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function ensurePrivateKey(hex?: string): Uint8Array {
  if (!hex) {
    throw new Error('TEE private key not configured');
  }
  const clean = hex.trim().replace(/^0x/, '');
  if (clean.length !== 64) {
    throw new Error('TEE private key must be 32-byte hex');
  }
  return Buffer.from(clean, 'hex');
}

function buildOutcomeBytes(outcome: Outcome): Buffer {
  if ('Numeric' in outcome) {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(outcome.Numeric.value);
    return buf;
  }
  if ('Shape' in outcome) {
    return Buffer.from([outcome.Shape.shape, outcome.Shape.color, outcome.Shape.size]);
  }
  if ('Pattern' in outcome) {
    const buf = Buffer.alloc(3);
    buf.writeUInt8(outcome.Pattern.pattern_id, 0);
    buf.writeUInt16LE(outcome.Pattern.matched_value, 1);
    return buf;
  }
  if ('Entropy' in outcome) {
    const buf = Buffer.alloc(6);
    buf.writeUInt16LE(outcome.Entropy.tee_score, 0);
    buf.writeUInt16LE(outcome.Entropy.chain_score, 2);
    buf.writeUInt16LE(outcome.Entropy.sensor_score, 4);
    return buf;
  }
  if ('Community' in outcome) {
    return Buffer.from([outcome.Community.final_byte, ...outcome.Community.seed_hash]);
  }
  return Buffer.alloc(0);
}

function buildOutcomeForMarket(rng: SeededRng, marketType: TeeMarketType, params: { chainHash?: Uint8Array; communitySeeds?: number[] }): Outcome {
  switch (marketType) {
    case 'PickRange':
      return { Numeric: { value: (rng.nextUint32() % 100) + 1 } };
    case 'EvenOdd':
      return { Numeric: { value: rng.nextUint32() % 2 } };
    case 'LastDigit':
      return { Numeric: { value: rng.nextUint32() % 10 } };
    case 'ModuloThree':
      return { Numeric: { value: rng.nextUint32() % 3 } };
    case 'PatternOfDay': {
      const value = rng.nextUint32() % 1000;
      let patternId = 6;
      if (isPrime(value)) patternId = 0;
      else if (isFibonacci(value)) patternId = 1;
      else if (isPerfectSquare(value)) patternId = 2;
      else if (value % 10 === 7) patternId = 3;
      else if (isPalindrome(value)) patternId = 4;
      else if (value % 2 === 0) patternId = 5;
      return { Pattern: { pattern_id: patternId, matched_value: value } };
    }
    case 'ShapeColor': {
      const shape = rng.nextUint32() % 4;
      const color = rng.nextUint32() % 6;
      const size = rng.nextUint32() % 3;
      return { Shape: { shape, color, size } };
    }
    case 'Jackpot':
      return { Numeric: { value: rng.nextUint32() % 100 } };
    case 'EntropyBattle': {
      const teeBytes = rng.nextBytes(32);
      const teeScore = calculateEntropyScore(teeBytes);
      const chain = params.chainHash ?? new Uint8Array(32);
      const chainScore = calculateEntropyScore(chain);
      const sensorBytes = rng.nextBytes(32);
      const sensorScore = calculateEntropyScore(sensorBytes);
      const winner = determineEntropyWinner(teeScore, chainScore, sensorScore);
      return { Entropy: { tee_score: teeScore, chain_score: chainScore, sensor_score: sensorScore, winner } };
    }
    case 'CommunitySeed': {
      const seeds = params.communitySeeds ?? [];
      if (!seeds.length) {
        return { Community: { final_byte: 0, seed_hash: new Array(32).fill(0) } };
      }
      const hash = createHash('sha256').update(Buffer.from(seeds)).digest();
      const finalByte = typeof hash[31] === 'number' ? hash[31]! : 0;
      return { Community: { final_byte: finalByte, seed_hash: Array.from(hash) } };
    }
    case 'StreakMeter':
      throw new Error('StreakMeter outcome must be handled via updateStreak');
    default:
      return { Numeric: { value: (rng.nextUint32() % 100) + 1 } };
  }
}

export async function generateOutcomeLocal(
  privateKeyHex: string | undefined,
  roundId: string,
  marketType: TeeMarketType,
  params: {
    chainHash?: Uint8Array;
    communitySeeds?: number[];
    vrfRandomness?: Uint8Array;
  }
): Promise<LocalTeeAttestation> {
  const privKey = ensurePrivateKey(privateKeyHex);
  const rng = new SeededRng(params.vrfRandomness);
  const outcome = buildOutcomeForMarket(rng, marketType, params);
  const nonceBytes = rng.nextBytes(32);
  const outcomeBytes = buildOutcomeBytes(outcome);
  const commitmentDigest = createHash('sha256').update(outcomeBytes).update(nonceBytes).digest();
  const commitment = commitmentDigest.toString('hex');

  const inputsHash = params.vrfRandomness && params.vrfRandomness.length === 32
    ? Buffer.from(params.vrfRandomness)
    : createHash('sha256').update(ENC.encode(JSON.stringify([roundId, marketType, outcome]))).digest();
  const signature = await signAsync(commitmentDigest, privKey, { prehash: false });
  const publicKey = getPublicKey(privKey, false);

  return {
    round_id: roundId,
    market_type: marketType,
    outcome,
    commitment_hash: commitment,
    nonce: bytesToHex(nonceBytes),
    inputs_hash: bytesToHex(inputsHash),
    code_measurement: CODE_MEASUREMENT_HEX,
    signature: Buffer.from(signature).toString('hex'),
    public_key: Buffer.from(publicKey).toString('hex'),
    timestamp: Math.floor(Date.now() / 1000),
    local_fallback: true,
  };
}
