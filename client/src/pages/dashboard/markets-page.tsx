import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { marketsService, type MarketSummary } from '@/services/markets.service'
import { TrendChart } from '@/components/dashboard/trend-chart'

type MarketCard = MarketSummary & {
  accent: { bg: string; border: string; chart: string }
  activityScore: number
  description: string
}

type MarketFilter = {
  id: string
  label: string
  predicate: (market: MarketCard) => boolean
}

const ACCENT_POOL = [
  { bg: 'rgba(185,246,201,0.08)', border: 'rgba(185,246,201,0.25)', chart: '#34d399' },
  { bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.25)', chart: '#8b8cf8' },
  { bg: 'rgba(244,114,182,0.08)', border: 'rgba(244,114,182,0.25)', chart: '#f472b6' },
  { bg: 'rgba(248,196,113,0.08)', border: 'rgba(248,196,113,0.25)', chart: '#fbbf24' },
  { bg: 'rgba(168,85,247,0.08)', border: 'rgba(168,85,247,0.25)', chart: '#a855f7' },
]

const DESCRIPTIONS: Record<string, string> = {
  PICK_RANGE: 'Partitioned number ranges with attested randomness.',
  EVEN_ODD: 'Quick parity plays powered by VRF proofs.',
  LAST_DIGIT: 'Predict last digits with tight time windows.',
  MODULO_THREE: 'Modulo outcomes tuned for streak players.',
  PATTERN_OF_DAY: 'Dynamic pattern recognition markets.',
  SHAPE_COLOR: 'Shape, color and size combinatorics.',
  JACKPOT: 'High-volatility jackpot pools.',
  ENTROPY_BATTLE: 'Entropy face-off between data sources.',
  STREAK_METER: 'Chase streak multipliers for legendary runs.',
  COMMUNITY_SEED: 'Crowd-sourced randomness with shared rewards.',
}

function humanize(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase())
}

function createFilters(markets: MarketCard[]): MarketFilter[] {
  const filters: MarketFilter[] = [{ id: 'all', label: 'All', predicate: () => true }]
  if (markets.some((market) => market.isActive)) {
    filters.push({ id: 'active', label: 'Active', predicate: (market) => market.isActive })
  }
  const maxBets = markets.reduce((max, market) => Math.max(max, market._count?.bets ?? 0), 0)
  if (maxBets > 0) {
    filters.push({
      id: 'popular',
      label: 'Popular',
      predicate: (market) => (market._count?.bets ?? 0) >= Math.max(3, Math.floor(maxBets * 0.6)),
    })
  }
  const segments = Array.from(new Set(markets.map((market) => market.type)))
  segments.forEach((type) => {
    filters.push({
      id: `type:${type}`,
      label: humanize(type),
      predicate: (market) => market.type === type,
    })
  })
  return filters
}

function decorateMarkets(markets: MarketSummary[]): MarketCard[] {
  return markets.map((market, index) => {
    const rounds = market._count?.rounds ?? 0
    const bets = market._count?.bets ?? 0
    const activityScore = rounds * 0.6 + bets * 1.2 + (market.isActive ? 5 : 0)
    return {
      ...market,
      accent: ACCENT_POOL[index % ACCENT_POOL.length],
      activityScore,
      description: DESCRIPTIONS[market.type] ?? 'Provably fair attested market.',
    }
  })
}

export function MarketsPage() {
  const [markets, setMarkets] = useState<MarketCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      try {
        const data = await marketsService.getAll()
        setMarkets(decorateMarkets(data))
      } catch (err) {
        console.error(err)
        setError('Unable to load markets')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filters = useMemo(() => createFilters(markets), [markets])

  useEffect(() => {
    if (!filters.find((filter) => filter.id === activeFilter)) {
      setActiveFilter(filters[0]?.id ?? 'all')
    }
  }, [activeFilter, filters])

  const filteredMarkets = useMemo(() => {
    const filter = filters.find((item) => item.id === activeFilter) ?? filters[0]
    return markets.filter(filter?.predicate ?? (() => true))
  }, [activeFilter, filters, markets])

  if (loading) {
    return <div className="dashboard-panel">Loading markets…</div>
  }

  if (error) {
    return <div className="dashboard-panel">{error}</div>
  }

  return (
    <div className="dashboard-panel dashboard-panel-split">
      <div className="dashboard-panel-header">
        <div>
          <h1 className="dashboard-title">Markets</h1>
          <p className="dashboard-subtitle">Select a market to explore rounds, odds and analytics</p>
        </div>
      </div>

      <div className="dashboard-filter-bar">
        {filters.map((filter) => (
          <button
            key={filter.id}
            className={['dashboard-filter-pill', activeFilter === filter.id ? 'active' : ''].join(' ')}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="dashboard-market-grid">
        {filteredMarkets.map((market) => (
          <button
            key={market.id}
            className="card dashboard-market-card"
            style={{ 
              background: market.accent.bg,
              borderColor: market.accent.border
            }}
            onClick={() => navigate(`/app/markets/${market.id}`)}
          >
            <div className="dashboard-market-card-header">
              <span className="dashboard-market-chip">{humanize(market.type)}</span>
              <span className={`dashboard-market-status ${market.isActive ? 'active' : 'paused'}`}>
                {market.isActive ? '● Live' : '○ Paused'}
              </span>
            </div>
            <h2 className="dashboard-market-title">{market.name}</h2>
            <p className="dashboard-market-description">{market.description}</p>
            <div className="dashboard-market-metrics">
              <div>
                <span className="dashboard-round-stat-label">Rounds</span>
                <strong style={{ color: market.accent.chart, fontWeight: 900 }}>{market._count?.rounds ?? 0}</strong>
              </div>
              <div>
                <span className="dashboard-round-stat-label">Bets</span>
                <strong style={{ color: market.accent.chart, fontWeight: 900 }}>{market._count?.bets ?? 0}</strong>
              </div>
              <div>
                <span className="dashboard-round-stat-label">Trend</span>
                <div style={{ width: '80px', height: '28px', marginTop: '0.25rem' }}>
                  <TrendChart value={market.activityScore / 10} color={market.accent.chart} height={28} />
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
