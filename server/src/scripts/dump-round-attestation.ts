import { Round, connectDatabase, disconnectDatabase } from '@/config/database'

const TEE_PUBKEY_HEX = '045d46d0709c22ee95239e903ec5fe4929c321908ea4a35787d2a5cfda275a5116451f29b8cbfff2d53f46e8f0e6718c0da84e6956f6bef91fc9bc7f0a3ee9b405'

async function main() {
  const roundId = process.argv[2]
  if (!roundId) {
    console.error('Usage: dump-round-attestation <roundId>')
    process.exit(1)
  }

  await connectDatabase()

  const round = await Round.findById(roundId).lean()
  if (!round) {
    console.error('Round not found:', roundId)
    await disconnectDatabase()
    process.exit(1)
  }

  const rawAtt = (round as any).attestation
  const att = typeof rawAtt === 'string' ? JSON.parse(rawAtt) : rawAtt

  console.log('--- Raw attestation object ---')
  console.log(JSON.stringify(att, null, 2))

  if (!att) {
    console.log('No attestation on round')
    await disconnectDatabase()
    return
  }

  const pub = String(att.public_key || att.pubkey || '')
  const sigHex = String(att.signature || '')
  const chHex = String(att.commitment_hash || '')

  const sigBytes = sigHex && /^[0-9a-fA-F]+$/.test(sigHex) ? Buffer.from(sigHex, 'hex') : Buffer.alloc(0)
  const chBytes = chHex && /^[0-9a-fA-F]+$/.test(chHex) ? Buffer.from(chHex, 'hex') : Buffer.alloc(0)

  console.log('--- Parsed fields ---')
  console.log('public_key:', pub)
  console.log('TEE_PUBKEY_HEX:', TEE_PUBKEY_HEX)
  console.log('public_key_equals_TEE_PUBKEY?', pub.toLowerCase() === TEE_PUBKEY_HEX.toLowerCase())
  console.log('commitment_hash_hex_length:', chHex.length, 'bytes:', chBytes.length)
  console.log('signature_hex_length:', sigHex.length, 'bytes:', sigBytes.length)

  await disconnectDatabase()
}

main().catch((err) => {
  console.error('Error dumping attestation:', err)
  process.exit(1)
})
