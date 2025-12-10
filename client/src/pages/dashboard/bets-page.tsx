import { useEffect, useState } from 'react'
import { betsService, type BetRecord } from '@/services/bets.service'

type BetStats = {
  totalBets?: number
  totalStake?: number
  totalPayout?: number
  winRate?: number
}

export function BetsPage() {
  const [bets, setBets] = useState<BetRecord[]>([])
  const [stats, setStats] = useState<BetStats>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [{ items }, metrics] = await Promise.all([
          betsService.list({ limit: 20 }),
          betsService.stats(),
        ])
        setBets(items)
        setStats(metrics as BetStats)
      } catch (err) {
        console.error(err)
        setError('Unable to load bets')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return <div className="dashboard-panel">Loading bets…</div>
  }

  if (error) {
    return <div className="dashboard-panel">{error}</div>
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div>
            <h1 className="dashboard-title">Betting Overview</h1>
            <p className="dashboard-subtitle">Performance across devnet rounds</p>
          </div>
        </div>
        <div className="dashboard-stats-grid">
          <div className="card dashboard-stat">
            <span className="dashboard-stat-label">Total Bets</span>
            <strong className="dashboard-stat-value">{stats.totalBets ?? 0}</strong>
          </div>
          <div className="card dashboard-stat">
            <span className="dashboard-stat-label">Total Stake</span>
            <strong className="dashboard-stat-value">{(stats.totalStake ?? 0) / 1_000_000_000} SOL</strong>
          </div>
          <div className="card dashboard-stat">
            <span className="dashboard-stat-label">Total Payout</span>
            <strong className="dashboard-stat-value">{(stats.totalPayout ?? 0) / 1_000_000_000} SOL</strong>
          </div>
          <div className="card dashboard-stat">
            <span className="dashboard-stat-label">Win Rate</span>
            <strong className="dashboard-stat-value">
              {stats.winRate ? `${(stats.winRate * 100).toFixed(1)}%` : '0%'}
            </strong>
          </div>
        </div>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div>
            <h2 className="dashboard-title">Recent Bets</h2>
            <p className="dashboard-subtitle">Latest confirmations across all markets</p>
          </div>
        </div>
        {bets.length === 0 ? (
          <div className="dashboard-empty">No bets yet.</div>
        ) : (
          <div className="dashboard-table-wrapper">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Round ID</th>
                  <th>Round</th>
                  <th>Status</th>
                  <th>Selection</th>
                  <th>Stake (SOL)</th>
                  <th>Payout (SOL)</th>
                  <th>Placed</th>
                </tr>
              </thead>
              <tbody>
                {bets.map((bet) => {
                  const roundDoc: any = (bet as any).round ?? (bet as any).roundId ?? null;
                  const roundIdStr = typeof (bet as any).roundId === 'string'
                    ? (bet as any).roundId
                    : (roundDoc?._id ? String(roundDoc._id) : (roundDoc?.id ?? '—'));
                  const roundNo = roundDoc?.roundNumber;
                  const marketName = roundDoc?.market?.name ?? roundDoc?.marketId?.name ?? bet.marketId;
                  const status = bet.status;
                  return (
                  <tr key={bet.id}>
                    <td>{marketName}</td>
                    <td><code className="dashboard-code">{roundIdStr}</code></td>
                    <td>{roundNo ? `#${roundNo}` : '—'}</td>
                    <td>
                      {status === 'PENDING' ? (
                        <span style={{display:'inline-flex',alignItems:'center',gap:'0.4rem'}}>
                          <span className="loading-spinner" style={{width:12,height:12,borderWidth:2}} /> Pending
                        </span>
                      ) : (
                        status
                      )}
                    </td>
                    <td>
                      <code className="dashboard-code">{JSON.stringify(bet.selection)}</code>
                    </td>
                    <td>{(bet.stake ?? 0) / 1_000_000_000}</td>
                    <td>{bet.payout ? bet.payout / 1_000_000_000 : 0}</td>
                    <td>{new Date(bet.createdAt).toLocaleString()}</td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
