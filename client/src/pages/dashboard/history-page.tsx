import { useEffect, useState } from 'react'
import { betsService, type BetRecord } from '@/services/bets.service'

type BetBuckets = {
  won: BetRecord[]
  lost: BetRecord[]
  refunded: BetRecord[]
}

const STATUS_LABELS: Record<keyof BetBuckets, string> = {
  won: 'Wins',
  lost: 'Losses',
  refunded: 'Refunded',
}

export function HistoryPage() {
  const [buckets, setBuckets] = useState<BetBuckets>({ won: [], lost: [], refunded: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [won, lost, refunded] = await Promise.all([
          betsService.list({ status: 'WON', limit: 20 }),
          betsService.list({ status: 'LOST', limit: 20 }),
          betsService.list({ status: 'REFUNDED', limit: 20 }),
        ])
        setBuckets({ won: won.items, lost: lost.items, refunded: refunded.items })
      } catch (err) {
        console.error(err)
        setError('Unable to load betting history')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return <div className="dashboard-panel">Loading history…</div>
  }

  if (error) {
    return <div className="dashboard-panel">{error}</div>
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div>
            <h1 className="dashboard-title">Bet History</h1>
            <p className="dashboard-subtitle">Recent outcomes across markets</p>
          </div>
        </div>
        <div className="dashboard-history-grid">
          {(Object.keys(buckets) as Array<keyof BetBuckets>).map((key) => {
            const bets = buckets[key]
            return (
              <div key={key} className="card dashboard-history-card">
                <h2 className="dashboard-history-title">{STATUS_LABELS[key]}</h2>
                {bets.length === 0 ? (
                  <div className="dashboard-empty">No {STATUS_LABELS[key].toLowerCase()} yet.</div>
                ) : (
                  <ul className="dashboard-history-list">
                    {bets.map((bet) => {
                      const roundDoc: any = (bet as any).round ?? (bet as any).roundId ?? null;
                      const roundIdStr = typeof (bet as any).roundId === 'string'
                        ? (bet as any).roundId
                        : (roundDoc?._id ? String(roundDoc._id) : (roundDoc?.id ?? '—'));
                      const marketName = roundDoc?.market?.name ?? roundDoc?.marketId?.name ?? bet.marketId;
                      return (
                      <li key={bet.id}>
                        <div className="dashboard-history-row">
                          <div>
                            <strong>{marketName}</strong>
                            <span>Round #{roundDoc?.roundNumber ?? '—'}</span>
                            <div><small className="dashboard-round-stat-label">ID:</small> <code className="dashboard-code">{roundIdStr}</code></div>
                          </div>
                          <div className="dashboard-history-meta">
                            <span>{(bet.stake ?? 0) / 1_000_000_000} SOL</span>
                            <span>{new Date(bet.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      </li>
                    )})}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
