import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type LeaderboardEntry = {
  rank: number
  userId: string
  walletAddress: string
  totalBets: number
  totalWon: number
  totalStake: number
  totalPayout: number
  winRate: number
  streak: number
}

type ApiResponse<T> = { success: boolean; data: T; message?: string }
type ServerLeaderboardItem = {
  rank: number
  user?: { id: string; walletAddress: string }
  totalWins?: number
  totalParticipations?: number
  winRate?: number
}

export function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const res = await api.get<ApiResponse<ServerLeaderboardItem[]>>('/community/leaderboard')
        const items = Array.isArray(res?.data) ? res.data : []
        const mapped: LeaderboardEntry[] = items.map((e, idx) => ({
          rank: e.rank ?? idx + 1,
          userId: e.user?.id ?? '',
          walletAddress: e.user?.walletAddress ?? '',
          totalBets: e.totalParticipations ?? 0,
          totalWon: e.totalWins ?? 0,
          totalStake: 0,
          totalPayout: 0,
          winRate: e.winRate ?? 0,
          streak: 0,
        }))
        setEntries(mapped)
      } catch (err) {
        console.error(err)
        setError('Unable to load leaderboard')
      } finally {
        setLoading(false)
      }
    }
    fetchLeaderboard()
  }, [])

  if (loading) {
    return <div className="dashboard-panel">Loading leaderboard…</div>
  }

  if (error) {
    return <div className="dashboard-panel">{error}</div>
  }

  return (
    <div className="dashboard-panel dashboard-panel-split">
      <div className="dashboard-panel-header">
        <h1 className="dashboard-title">Leaderboard</h1>
        <span className="dashboard-subtitle">{entries.length} players ranked</span>
      </div>

      <div className="dashboard-table-wrapper">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Total Bets</th>
              <th>Won</th>
              <th>Win Rate</th>
              <th>Streak</th>
              <th>Total Staked</th>
              <th>Total Payout</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={entry.userId}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {index === 0 && <span style={{ fontSize: '1.2rem' }}>🥇</span>}
                    {index === 1 && <span style={{ fontSize: '1.2rem' }}>🥈</span>}
                    {index === 2 && <span style={{ fontSize: '1.2rem' }}>🥉</span>}
                    <strong>#{entry.rank || index + 1}</strong>
                  </div>
                </td>
                <td>
                  <code className="dashboard-code">
                    {entry.walletAddress
                      ? `${entry.walletAddress.slice(0, 4)}…${entry.walletAddress.slice(-4)}`
                      : 'Unknown'}
                  </code>
                </td>
                <td>{entry.totalBets}</td>
                <td style={{ color: 'var(--accent)' }}>{entry.totalWon}</td>
                <td>
                  <span style={{
                    color: entry.winRate >= 50 ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: entry.winRate >= 50 ? 600 : 400
                  }}>
                    {entry.winRate.toFixed(1)}%
                  </span>
                </td>
                <td>
                  {entry.streak > 0 && (
                    <span style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '999px',
                      background: 'rgba(185,246,201,0.15)',
                      color: 'var(--accent)',
                      fontSize: '0.75rem',
                      fontWeight: 600
                    }}>
                      🔥 {entry.streak}
                    </span>
                  )}
                  {entry.streak === 0 && <span style={{ color: 'var(--muted)' }}>-</span>}
                </td>
                <td>{(entry.totalStake / 1_000_000_000).toFixed(2)} SOL</td>
                <td style={{ color: 'var(--accent)' }}>
                  {(entry.totalPayout / 1_000_000_000).toFixed(2)} SOL
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entries.length === 0 && (
        <div className="dashboard-empty">No leaderboard entries yet. Be the first to place a bet!</div>
      )}
    </div>
  )
}
