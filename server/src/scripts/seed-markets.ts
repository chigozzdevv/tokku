import { connectDatabase, disconnectDatabase, Market } from '@/config/database'

type Entry = {
  name: string
  type: string
  config: { mintAddress: string; houseEdgeBps: number; solanaAddress: string; partitionCount?: number }
  isActive?: boolean
}

const entries: Entry[] = [
  { name: 'Range (2)', type: 'PICK_RANGE', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 3333, solanaAddress: 'FsiXB9gMQzZ7yVDxUZay12UrtokJsGjJKMkRstbM5Th3', partitionCount: 2 } },
  { name: 'Range (4)', type: 'PICK_RANGE', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 6000, solanaAddress: '9sMVcMuZ5vjpCyyCqirHhGgsA64zmjGHiaNGU726EdjU', partitionCount: 4 } },
  { name: 'Range (10)', type: 'PICK_RANGE', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 4286, solanaAddress: '5omSBAZWjYrayhhXXqmixqrtfTWt3tYf3g5D3ZCVmLxN', partitionCount: 10 } },
  { name: 'Even / Odd', type: 'EVEN_ODD', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 200, solanaAddress: 'BZsjvDAqZAUQcjCQCbigCub9wqFh8zYaGDHzVbwKpzzy' } },
  { name: 'Last Digit', type: 'LAST_DIGIT', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 200, solanaAddress: 'A4bK73EnkjwfmKpUMN8r5hQ3F3pqZPggEuDAWZwRnZj5' } },
  { name: 'Modulo-3', type: 'MODULO_THREE', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 5000, solanaAddress: 'dvP6tMCjko5JHGABogN9BoLxgJe8Huaw1rtkYjYu6pU' } },
  { name: 'Pattern of Day', type: 'PATTERN_OF_DAY', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 6000, solanaAddress: '9ugyk2PStsFaDqJLD6FqqQu3VYH4AHuP6avUpLhJAJxV' } },
  { name: 'Shape & Color', type: 'SHAPE_COLOR', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 6000, solanaAddress: 'Hcq2TLsTNVyHJb8C9uqJVj4LV5YrKHfhxhz6CZLJ2uzD' } },
  { name: 'Jackpot', type: 'JACKPOT', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 1111, solanaAddress: 'CESozFquVRZ4KrCKS9AF9H3se7Mgfk2pDpr7btppdUrA' } },
  { name: 'Entropy Battle', type: 'ENTROPY_BATTLE', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 2000, solanaAddress: '7hgzXPNJnYFCTmbCpdYZnhwPDgu2yKn7gVUnD14Y7bfZ' } },
  { name: 'Community Seed', type: 'COMMUNITY_SEED', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 6000, solanaAddress: 'vPyX5xEjcFhyQyLbt7X7rN2rJWyVhVaU1mTmtZa5oVM' } },
  { name: 'Streak Meter', type: 'STREAK_METER', config: { mintAddress: 'So11111111111111111111111111111111111111112', houseEdgeBps: 200, solanaAddress: '3sccC8fpexjDAsukuyynd4vvfVCNbJrJAJQKivECdYLJ' } },
]

async function main() {
  await connectDatabase()
  let upserted = 0
  for (const e of entries) {
    const res = await Market.updateOne(
      { name: e.name },
      { $set: { name: e.name, type: e.type, config: e.config, isActive: e.isActive ?? true } },
      { upsert: true }
    )
    if ((res as any).upsertedId || (res as any).modifiedCount > 0) upserted++
  }
  const count = await Market.countDocuments({})
  console.log(JSON.stringify({ upserted, total: count }, null, 2))
  await disconnectDatabase()
}

main().catch((e) => { console.error(e); process.exit(1) })
