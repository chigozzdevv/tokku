import { Connection, PublicKey } from '@solana/web3.js';

export type Outcome =
  | { Numeric: { value: number } }
  | { Shape: { shape: number; color: number; size: number } }
  | { Pattern: { pattern_id: number; matched_value: number } }
  | { Entropy: { tee_score: number; chain_score: number; sensor_score: number; winner: number } }
  | { Community: { final_byte: number; seed_hash: string } };

export type RoundState = {
  commitmentHash: string | null;
  inputsHash: string | null;
  outcome: Outcome | null;
};

function bytesToHex(bytes: number[] | Uint8Array | null | undefined): string | null {
  if (!bytes) return null;
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return Buffer.from(arr).toString('hex');
}

export async function fetchRoundStateRaw(
  connection: Connection,
  roundPda: PublicKey,
): Promise<RoundState | null> {
  try {
    const info = await connection.getAccountInfo(roundPda);
    if (!info) return null;
    const buf = info.data;
    let o = 0;
    o += 8;
    o += 32;
    o += 8;
    o += 1;
    const inputsHash = Buffer.from(buf.subarray(o, o + 32)).toString('hex');
    o += 32;
    const variant = buf.readUInt8(o); o += 1;
    let outcome: Outcome | null = null;
    switch (variant) {
      case 0:
        outcome = null;
        break;
      case 1:
        outcome = { Numeric: { value: buf.readUInt16LE(o) } };
        o += 2;
        break;
      case 2:
        outcome = { Shape: { shape: buf.readUInt8(o), color: buf.readUInt8(o + 1), size: buf.readUInt8(o + 2) } };
        o += 3;
        break;
      case 3:
        outcome = { Pattern: { pattern_id: buf.readUInt8(o), matched_value: buf.readUInt16LE(o + 1) } };
        o += 3;
        break;
      case 4:
        outcome = {
          Entropy: {
            tee_score: buf.readUInt16LE(o),
            chain_score: buf.readUInt16LE(o + 2),
            sensor_score: buf.readUInt16LE(o + 4),
            winner: buf.readUInt8(o + 6),
          }
        };
        o += 7;
        break;
      case 5:
        outcome = { Community: { final_byte: buf.readUInt8(o), seed_hash: Buffer.from(buf.subarray(o + 1, o + 33)).toString('hex') } };
        o += 33;
        break;
      default:
        outcome = null;
    }
    o += 4;
    o += 8;
    o += 8;
    o += 8;
    const opt = buf.readUInt8(o); o += 1;
    let commitmentHash: string | null = null;
    if (opt === 1) {
      commitmentHash = Buffer.from(buf.subarray(o, o + 32)).toString('hex');
      o += 32;
    }
    return { commitmentHash, inputsHash, outcome };
  } catch {
    return null;
  }
}
