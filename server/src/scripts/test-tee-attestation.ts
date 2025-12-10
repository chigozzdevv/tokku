import { connectDatabase, disconnectDatabase, Round } from '@/config/database'
import { getMarketConfig } from '@/utils/market-config'
import { config } from '@/config/env'
import { getAdminKeypair } from '@/config/admin-keypair'
import { TokkuProgramService } from '@/solana/tokku-program-service'
import { TeeService } from '@/solana/tee-service'
import { fetchRoundStateRaw } from '@/solana/round-reader'
import { Connection, PublicKey } from '@solana/web3.js'

function getArg(name: string): string | undefined {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a) continue
    if (a === `--${name}`) return args[i + 1]
    if (a.startsWith(`--${name}=`)) return a.split('=')[1]
  }
  return undefined
}

async function main() {
  await connectDatabase()

  const roundIdArg = getArg('roundId')
  const preferLocked = getArg('preferLocked') !== 'false'
  const doCommit = getArg('commit') === 'true'
  const doReveal = getArg('reveal') === 'true'
  const forceInputs = getArg('forceInputsHash') !== 'false'

  let round: any
  if (roundIdArg) {
    round = await Round.findById(roundIdArg).populate({ path: 'marketId', model: 'Market' }).lean()
  } else {
    round = await Round.findOne({ status: preferLocked ? 'LOCKED' : 'PREDICTING' })
      .sort(preferLocked ? { lockedAt: -1 } : { openedAt: -1 })
      .populate({ path: 'marketId', model: 'Market' })
      .lean()
  }
  if (!round) throw new Error('No suitable round found')

  const marketCfg = getMarketConfig(round.marketId.config)
  const marketPk = new PublicKey(marketCfg.solanaAddress)
  const tossr = new TokkuProgramService()
  const tee = new TeeService()
  const roundPda = await tossr.getRoundPda(marketPk, round.roundNumber)

  const erConn = new Connection(config.EPHEMERAL_RPC_URL)
  const baseConn = new Connection(config.SOLANA_RPC_URL)

  let inputsHash: string | null = null
  for (let i = 0; i < 30; i++) {
    const [erState, baseState] = await Promise.all([
      fetchRoundStateRaw(erConn, roundPda),
      fetchRoundStateRaw(baseConn, roundPda),
    ])
    const state = erState?.inputsHash && !/^0+$/.test(erState.inputsHash) ? erState : baseState
    if (state && state.inputsHash && !/^0+$/.test(state.inputsHash)) {
      inputsHash = state.inputsHash
      break
    }
    await new Promise(r => setTimeout(r, 1000))
  }

  if (!inputsHash) throw new Error('VRF inputsHash not found; run vrf:request first')

  const chainHash = await tee.getLatestBlockhash()
  const vrfRandomness = Buffer.from(inputsHash, 'hex')

  const attestation = await tee.generateOutcome(
    String(round._id),
    round.marketId.type,
    { chainHash, vrfRandomness }
  )

  if (forceInputs && attestation && typeof attestation === 'object') {
    (attestation as any).inputs_hash = inputsHash.toLowerCase()
  }

  console.log('TEE attestation OK', {
    roundId: String(round._id),
    roundNumber: round.roundNumber,
    commitment: attestation.commitment_hash,
    inputsHash: attestation.inputs_hash,
    outcome: attestation.outcome && Object.keys(attestation.outcome)[0]
  })

  const save = getArg('save') === 'true'
  if (save) {
    await Round.updateOne({ _id: round._id }, { $set: { attestation } })
    console.log('Saved attestation to DB')
  }

  if (doCommit || doReveal) {
    const admin = getAdminKeypair()
    let isDelegated = Boolean(round.delegateTxHash && !round.undelegateTxHash)
    if (!isDelegated) {
      const tossr = new TokkuProgramService()
      try {
        await tossr.delegateRound(marketPk, round.roundNumber, admin)
        isDelegated = true
      } catch {}
    }
    const tossr = new TokkuProgramService()
    const commitmentHash = Buffer.from(attestation.commitment_hash, 'hex')
    const attestationSig = Buffer.from(attestation.signature, 'hex')
    if (doCommit) {
      if (isDelegated) {
        console.log('Skipping commit on ER (attestation not required for ER reveal)')
      } else {
        const sig = await tossr.commitOutcomeHash(marketPk, round.roundNumber, commitmentHash, attestationSig, admin, { useER: isDelegated })
        console.log('Commit sent:', { signature: sig })
      }
    }
    if (doReveal) {
      const nonce = Buffer.from(attestation.nonce, 'hex')
      const inputs = Buffer.from(attestation.inputs_hash, 'hex')
      const outcome = attestation.outcome as any
      let sig: string
      if (outcome?.Numeric) {
        sig = isDelegated
          ? await tossr.revealOutcomeER(marketPk, round.roundNumber, outcome.Numeric.value, admin)
          : await tossr.revealOutcome(marketPk, round.roundNumber, outcome.Numeric.value, nonce, inputs, attestationSig, admin)
      } else if (outcome?.Shape) {
        sig = isDelegated
          ? await tossr.revealShapeOutcomeER(marketPk, round.roundNumber, outcome.Shape.shape, outcome.Shape.color, outcome.Shape.size, admin)
          : await tossr.revealShapeOutcome(marketPk, round.roundNumber, outcome.Shape.shape, outcome.Shape.color, outcome.Shape.size, nonce, inputs, attestationSig, admin)
      } else if (outcome?.Pattern) {
        const pid = outcome.Pattern.pattern_id ?? outcome.Pattern.patternId
        const mv = outcome.Pattern.matched_value ?? outcome.Pattern.matchedValue
        sig = isDelegated
          ? await tossr.revealPatternOutcomeER(marketPk, round.roundNumber, pid, mv, admin)
          : await tossr.revealPatternOutcome(marketPk, round.roundNumber, pid, mv, nonce, inputs, attestationSig, admin)
      } else if (outcome?.Entropy) {
        sig = isDelegated
          ? await tossr.revealEntropyOutcomeER(marketPk, round.roundNumber, outcome.Entropy.tee_score, outcome.Entropy.chain_score, outcome.Entropy.sensor_score, admin)
          : await tossr.revealEntropyOutcome(marketPk, round.roundNumber, outcome.Entropy.tee_score, outcome.Entropy.chain_score, outcome.Entropy.sensor_score, outcome.Entropy.winner, nonce, inputs, attestationSig, admin)
      } else if (outcome?.Community) {
        const seedHash = Array.isArray(outcome.Community.seed_hash) ? Buffer.from(outcome.Community.seed_hash) : Buffer.from(outcome.Community.seed_hash, 'hex')
        sig = isDelegated
          ? await tossr.revealCommunityOutcomeER(marketPk, round.roundNumber, outcome.Community.final_byte ?? outcome.Community.finalByte, seedHash, admin)
          : await tossr.revealCommunityOutcome(marketPk, round.roundNumber, outcome.Community.final_byte ?? outcome.Community.finalByte, seedHash, nonce, inputs, attestationSig, admin)
      } else {
        throw new Error('Unsupported outcome')
      }
      console.log('Reveal sent:', { signature: sig })
    }
  }

  await disconnectDatabase()
}

main().catch(async (e) => {
  console.error('Error:', e?.message || e)
  try { await disconnectDatabase() } catch {}
  process.exit(1)
})
