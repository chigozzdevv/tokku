import { useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useAuth } from '@/providers/auth-provider'
import { PublicKey } from '@solana/web3.js'

export function ProfilePage() {
  const { user } = useAuth()
  const { connection } = useConnection()
  const wallet = useWallet()
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    async function fetchBalance(pk: string) {
      try {
        const lamports = await connection.getBalance(new PublicKey(pk))
        setBalance(lamports / 1_000_000_000)
      } catch (error) {
        console.error(error)
        setBalance(null)
      }
    }
    if (user?.walletAddress) {
      fetchBalance(user.walletAddress)
    }
  }, [connection, user?.walletAddress])

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <div>
          <h1 className="dashboard-title">Profile</h1>
          <p className="dashboard-subtitle">Wallet identity and devnet details</p>
        </div>
      </div>
      <div className="dashboard-profile-grid">
        <div className="card dashboard-profile-card">
          <span className="dashboard-stat-label">Wallet address</span>
          <strong className="dashboard-stat-value dashboard-address">{user?.walletAddress}</strong>
          <span className="dashboard-chip">Connected via {wallet.wallet?.adapter.name ?? 'unknown wallet'}</span>
        </div>
        <div className="card dashboard-profile-card">
          <span className="dashboard-stat-label">Devnet balance</span>
          <strong className="dashboard-stat-value">{balance != null ? `${balance.toFixed(4)} SOL` : '—'}</strong>
          <span className="dashboard-chip">Commitment: confirmed</span>
        </div>
      </div>
    </div>
  )
}
