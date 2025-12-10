import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ParticleField } from '@/components/animations/particle-field'
import { Button } from '@/components/ui/button'
import { useWalletAuth } from '@/hooks/use-wallet-auth'
import { useAuth } from '@/providers/auth-provider'

export function Hero() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { connect, loading, error, clearError } = useWalletAuth()

  const handleConnect = useCallback(async () => {
    clearError()
    if (user) {
      navigate('/app')
      return
    }
    await connect()
  }, [clearError, connect, navigate, user])

  return (
    <section className="hero">
      <ParticleField />
      <div className="container hero-inner">
        <div>
          <h1 className="hero-heading">Bet on Provable Randomness</h1>
          <p className="hero-sub">
            TEE-attested randomness via MagicBlock PER + VRF for range, parity, digit,
            modulo, pattern, jackpot and community markets — all settled in SOL on Solana.
          </p>
          <div className="row row-center hero-cta">
            <button className="btn btn-primary" onClick={handleConnect} disabled={loading}>
              {loading ? 'Connecting…' : 'Connect Wallet'}
            </button>
            <Button aria-label="View live rounds" asChild>
              <a href="#live-rounds">View live rounds</a>
            </Button>
          </div>
          {error ? <div className="hero-error">{error}</div> : null}
        </div>
      </div>
    </section>
  )
}
