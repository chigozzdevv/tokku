import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { marketsService, type MarketDetail } from '@/services/markets.service'
import { Button } from '@/components/ui/button'

type RoundRow = MarketDetail['rounds'][number]

const STATUS_LABELS: Record<string, string> = {
  PREDICTING: 'Predicting',
  LOCKED: 'Locked',
  REVEALED: 'Revealed',
  SETTLED: 'Settled',
  FAILED: 'Expired',
}

function formatDateTime(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

export function MarketDetailPage() {
  const { marketId } = useParams<{ marketId: string }>()
  const [market, setMarket] = useState<MarketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [roundFilter, setRoundFilter] = useState<'all' | 'active' | 'history'>('active')
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      if (!marketId) return
      try {
        const data = await marketsService.getById(marketId)
        setMarket(data)
      } catch (err) {
        console.error(err)
        setError('Unable to load market')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [marketId])

  const rounds = useMemo(() => {
    if (!market) return [] as RoundRow[]
    const list = market.rounds ?? []
    switch (roundFilter) {
      case 'active':
        return list.filter((round) => round.status === 'PREDICTING' || round.status === 'LOCKED')
      case 'history':
        return list.filter((round) => round.status === 'SETTLED' || round.status === 'FAILED')
      default:
        return list
    }
  }, [market, roundFilter])

  if (loading) {
    return <div className="dashboard-panel">Loading market…</div>
  }

  if (error || !market) {
    return <div className="dashboard-panel">{error || 'Market not found'}</div>
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel dashboard-market-hero" style={{ background: 'linear-gradient(135deg, rgba(185,246,201,0.18), rgba(17,23,19,0.8))' }}>
        <div className="dashboard-market-hero-content">
          <div>
            <span className="dashboard-market-chip large">{market.type.replace(/_/g, ' ')}</span>
            <h1 className="dashboard-title">{market.name}</h1>
            <p className="dashboard-subtitle">{typeof market.config === 'string' ? 'Configurable attested market' : 'Live Solana market powered by Tossr engine.'}</p>
          </div>
          <div className="dashboard-market-hero-metrics">
            <div>
              <span className="dashboard-round-stat-label">Rounds</span>
              <strong>{market.rounds.length}</strong>
            </div>
            <div>
              <span className="dashboard-round-stat-label">Status</span>
              <strong>{market.isActive ? 'Active' : 'Paused'}</strong>
            </div>
            <div>
              <span className="dashboard-round-stat-label">Latest Round</span>
              <strong>{market.rounds[0]?.roundNumber ?? '—'}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div>
            <h2 className="dashboard-title">Rounds</h2>
            <p className="dashboard-subtitle">Browse recent rounds and jump into live betting</p>
          </div>
          <div className="dashboard-filter-group">
            <button
              className={['dashboard-filter-pill', roundFilter === 'active' ? 'active' : ''].join(' ')}
              onClick={() => setRoundFilter('active')}
            >
              Active
            </button>
            <button
              className={['dashboard-filter-pill', roundFilter === 'history' ? 'active' : ''].join(' ')}
              onClick={() => setRoundFilter('history')}
            >
              History
            </button>
            <button
              className={['dashboard-filter-pill', roundFilter === 'all' ? 'active' : ''].join(' ')}
              onClick={() => setRoundFilter('all')}
            >
              All
            </button>
          </div>
        </div>

        {rounds.length === 0 ? (
          <div className="dashboard-empty">No rounds available for this view.</div>
        ) : (
          <div className="dashboard-round-table-wrapper">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>Locked</th>
                  <th>Settled</th>
                  <th>Bets</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((round) => (
                  <tr key={round.id}>
                    <td>{round.roundNumber}</td>
                    <td>{STATUS_LABELS[round.status] ?? round.status}</td>
                    <td>{formatDateTime(round.openedAt)}</td>
                    <td>{formatDateTime(round.lockedAt)}</td>
                    <td>{formatDateTime(round.settledAt)}</td>
                    <td>{round._count?.bets ?? 0}</td>
                    <td>
                      <Button variant="primary" onClick={() => navigate(`/app/rounds/${round.id}`)}>
                        View round
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
