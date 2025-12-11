import { connectDatabase, disconnectDatabase, Round, Market } from '@/config/database'
import { config } from '@/config/env'
import { getAdminKeypair } from '@/config/admin-keypair'
import { TokkuProgramService } from '@/solana/tokku-program-service'
import { getMarketConfig } from '@/utils/market-config'
import { Connection, PublicKey } from '@solana/web3.js'
import { fetchRoundStateRaw } from '@/solana/round-reader'

async function main() {
  await connectDatabase()
  const args = process.argv.slice(2)
  const getArg = (k: string) => {
    const i = args.findIndex(a => a === `--${k}` || a.startsWith(`--${k}=`))
    if (i === -1) return undefined
    const v = args[i]
    if (v && v.includes('=')) return v.split('=')[1]
    return args[i + 1]
  }

  const roundIdArg = getArg('roundId')
  const marketIdArg = getArg('marketId')
  const roundNumberArg = getArg('roundNumber')

  let round: any
  if (roundIdArg) {
    round = await Round.findById(roundIdArg).populate({ path: 'marketId', model: 'Market' }).lean()
  } else if (marketIdArg && roundNumberArg) {
    round = await Round.findOne({ marketId: marketIdArg, roundNumber: Number(roundNumberArg) }).populate({ path: 'marketId', model: 'Market' }).lean()
  } else {
    round = await Round.findOne({ status: 'LOCKED' }).sort({ lockedAt: -1 }).populate({ path: 'marketId', model: 'Market' }).lean()
  }
  if (!round) throw new Error('Round not found')

  const admin = getAdminKeypair()
  const marketCfg = getMarketConfig(round.marketId.config)
  const marketPk = new PublicKey(marketCfg.solanaAddress)
  const isDelegated = Boolean(round.delegateTxHash && !round.undelegateTxHash)
  const clientSeed = round.roundNumber % 256

  const tokkuProgram = new TokkuProgramService()
  const sig = await tokkuProgram.requestRandomnessER(
    marketPk,
    round.roundNumber,
    clientSeed,
    admin,
    new PublicKey(config.VRF_ORACLE_QUEUE),
    { useER: isDelegated }
  )
  console.log('VRF request sent:', { signature: sig, roundId: String(round._id), roundNumber: round.roundNumber, isDelegated })

  const roundPda = await tokkuProgram.getRoundPda(marketPk, round.roundNumber)
  const erConn = new Connection(config.EPHEMERAL_RPC_URL)
  const baseConn = new Connection(config.SOLANA_RPC_URL)

  let found = null as any
  for (let i = 0; i < 30; i++) {
    const [erState, baseState] = await Promise.all([
      fetchRoundStateRaw(erConn, roundPda),
      fetchRoundStateRaw(baseConn, roundPda),
    ])
    const state = erState?.inputsHash && !/^0+$/.test(erState.inputsHash) ? erState : baseState
    if (state && state.inputsHash && !/^0+$/.test(state.inputsHash)) {
      found = state
      break
    }
    await new Promise(r => setTimeout(r, 2000))
  }

  if (!found) {
    console.log('VRF inputsHash not observed within timeout')
  } else {
    console.log('VRF inputsHash observed:', { inputsHash: found.inputsHash })
  }

  await disconnectDatabase()
}

main().catch(async (e) => {
  console.error('Error:', e?.message || e)
  try { await disconnectDatabase() } catch {}
  process.exit(1)
})
