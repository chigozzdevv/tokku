import { TeeService } from '@/solana/tee-service'
import { config } from '@/config/env'
import { randomBytes } from 'crypto'

async function main() {
  ;(config as any).TEE_PRIVATE_KEY_HEX = ''

  const tee = new TeeService()
  const rnd = randomBytes(32)

  const att = await tee.generateOutcome(
    'test-round',
    'PICK_RANGE',
    { chainHash: rnd, vrfRandomness: rnd }
  )

  console.log('--- TEE generateOutcome response ---')
  console.log(JSON.stringify(att, null, 2))

  const pub = String((att as any).public_key || '')
  const localFallback = Boolean((att as any).local_fallback)

  const teePubkeyHex = '045d46d0709c22ee95239e903ec5fe4929c321908ea4a35787d2a5cfda275a5116451f29b8cbfff2d53f46e8f0e6718c0da84e6956f6bef91fc9bc7f0a3ee9b405'

  console.log('local_fallback:', localFallback)
  console.log('public_key:', pub)
  console.log('matches_onchain_TEE_PUBKEY:', pub.toLowerCase() === teePubkeyHex.toLowerCase())
}

main().catch((err) => {
  console.error('TEE test failed', err)
  process.exit(1)
})
