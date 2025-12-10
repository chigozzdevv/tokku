import { useState } from 'react'
import { useAuth } from '@/providers/auth-provider'

export function SettingsPage() {
  const { refreshSession, user } = useAuth()
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRefreshToken() {
    setLoading(true)
    setMessage('')
    try {
      await refreshSession()
      setMessage('Session refreshed')
    } catch (error) {
      console.error(error)
      setMessage('Unable to refresh session')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <div>
          <h1 className="dashboard-title">Settings</h1>
          <p className="dashboard-subtitle">Manage your Tossr dashboard session</p>
        </div>
      </div>
      <div className="dashboard-settings">
        <div className="card dashboard-setting">
          <div>
            <h2>Session</h2>
            <p>Refresh your JWT session token and sync wallet data.</p>
          </div>
          <button className="btn" onClick={handleRefreshToken} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh session'}
          </button>
        </div>
        <div className="card dashboard-setting">
          <div>
            <h2>Connection</h2>
            <p>Currently authenticated as {user?.walletAddress} on devnet.</p>
          </div>
        </div>
        {message ? <div className="dashboard-error">{message}</div> : null}
      </div>
    </div>
  )
}
