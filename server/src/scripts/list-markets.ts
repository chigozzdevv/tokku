import { connectDatabase, disconnectDatabase, Market } from '@/config/database'

async function main() {
  await connectDatabase()
  const markets = await Market.find({}).select('name type').lean()
  console.log(JSON.stringify({ count: markets.length, markets: markets.map((m: any) => ({ name: m.name, type: m.type })) }, null, 2))
  await disconnectDatabase()
}

main().catch((e) => { console.error(e); process.exit(1) })
