import 'dotenv/config'
import { Market, connectDatabase, disconnectDatabase } from '@/config/database'
import { getAdminKeypair } from '@/config/admin-keypair'
import { TokkuProgramService } from '@/solana/tokku-program-service'
import { PublicKey } from '@solana/web3.js'

function args() {
  const out: Record<string, string> = {}
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.+)$/)
    if (m && m[1] && m[2]) out[m[1]] = m[2]
  }
  return out
}

const MT = {
  PICK_RANGE: 0,
  EVEN_ODD: 1,
  LAST_DIGIT: 2,
  MODULO_THREE: 3,
  PATTERN_OF_DAY: 4,
  SHAPE_COLOR: 5,
  JACKPOT: 6,
  ENTROPY_BATTLE: 7,
  STREAK_METER: 8,
  COMMUNITY_SEED: 9,
} as const

async function main() {
  await connectDatabase()
  const p = args()
  const name = p.name
  type MarketTypeKey = keyof typeof MT
  const typeKey = p.type as MarketTypeKey | undefined
  const mint = p.mint
  const index = Number(p.index)
  const bps = Number(p.edge ?? p.bps ?? 0)
  const partitionCount = p.partition ? Number(p.partition) : undefined
  const skipOnchain = p.skip === 'true' || p.skip === '1'
  if (!name || !typeKey || !(typeKey in MT) || !mint || isNaN(index)) {
    throw new Error('Usage: --name=... --type=PICK_RANGE|... --mint=<pubkey> --index=<u16> [--edge=0..10000] [--partition=2|4|10] [--skip=true]')
  }
  const typeCode = MT[typeKey as MarketTypeKey]

  const admin = getAdminKeypair()
  const svc = new TokkuProgramService()
  const mintPk = new PublicKey(mint)

  const { signature, marketPda } = skipOnchain
    ? { signature: 'skipped', marketPda: await svc.getMarketPdaByIndex(admin.publicKey, index) }
    : await svc.initializeMarket(admin, name, bps, typeCode, index, mintPk)

  // Persist in DB (create or update by name)
  const existing = await Market.findOne({ name }).lean()
  let id: string
  if (existing) {
    await Market.updateOne(
      { _id: (existing as any)._id },
      { $set: { isActive: true, config: { ...(existing as any).config || {}, solanaAddress: marketPda.toString(), mintAddress: mint, houseEdgeBps: bps, ...(partitionCount ? { partitionCount } : {}) } } }
    )
    id = String((existing as any)._id)
  } else {
    const created = await Market.create({
      name,
      type: typeKey as string,
      isActive: true,
      description: null,
      config: {
        solanaAddress: marketPda.toString(),
        mintAddress: mint,
        houseEdgeBps: bps,
        ...(partitionCount ? { partitionCount } : {}),
      },
    } as any)
    id = String((created as any)._id)
  }

  console.log(JSON.stringify({ id, name, type: typeKey, index, marketPda: marketPda.toString(), tx: signature }, null, 2))
  await disconnectDatabase()
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })

