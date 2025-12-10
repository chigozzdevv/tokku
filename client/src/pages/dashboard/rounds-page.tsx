import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { roundsService, type Round } from '@/services/rounds.service'
import { buildRoundOptions, humanizeMarketType } from './round-utils'
import { TrendChart } from '@/components/dashboard/trend-chart'
import { CountdownTimer } from '@/components/dashboard/countdown-timer'
import { RollingDice } from '@/components/dashboard/rolling-dice'

type RoundSelectionEntry = {
  id: string
  round: Round
  label: string
  odds: number
  coverage?: string
  accent: { bg: string; border: string; chart: string }
  timeLeftLabel: string
  timeRatio: number
  trend: number
  bets: number
  selection: any
  endsAt: Date
}

const ROUND_DURATION_SECONDS = Number(import.meta.env.VITE_ROUND_DURATION_SECONDS ?? 600)
const ROUND_DURATION_MS = ROUND_DURATION_SECONDS * 1000
const ACCENTS = [
  { bg: 'rgba(185,246,201,0.08)', border: 'rgba(185,246,201,0.25)', chart: '#62df98' },
  { bg: 'rgba(138,180,248,0.08)', border: 'rgba(138,180,248,0.25)', chart: '#8b8cf8' },
  { bg: 'rgba(168,85,247,0.08)', border: 'rgba(168,85,247,0.25)', chart: '#a855f7' },
  { bg: 'rgba(244,114,182,0.08)', border: 'rgba(244,114,182,0.25)', chart: '#f472b6' },
  { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.25)', chart: '#fbbf24' },
]

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function deriveTimeMeta(baseAt?: string) {
  if (!baseAt) {
    return { label: 'Pending', ratio: 0 }
  }
  const opened = new Date(baseAt).getTime()
  const now = Date.now()
  const elapsed = clamp(now - opened, 0, ROUND_DURATION_MS)
  const ratio = ROUND_DURATION_MS === 0 ? 0 : elapsed / ROUND_DURATION_MS
  const remaining = opened + ROUND_DURATION_MS - now
  if (remaining <= 0) {
    return { label: 'Closing', ratio: 1 }
  }
  const minutes = Math.floor(remaining / 1000 / 60)
  const seconds = Math.floor((remaining / 1000) % 60)
  return { label: `${minutes}m ${seconds.toString().padStart(2, '0')}s`, ratio }
}

function buildSelectionEntries(round: Round): RoundSelectionEntry[] {
  const options = buildRoundOptions(round)
  const baseAt = round.scheduledReleaseAt || round.openedAt
  const { label: timeLeftLabel, ratio: timeRatio } = deriveTimeMeta(baseAt)
  const bets = round._count?.bets ?? 0
  const start = baseAt ? new Date(baseAt).getTime() : Date.now()
  const endsAt = new Date(start + ROUND_DURATION_MS)

  return options.map((option, idx) => ({
    id: `${round.id}-${option.id}`,
    round,
    label: option.label,
    odds: option.odds,
    coverage: option.coverage,
    accent: ACCENTS[idx % ACCENTS.length],
    timeLeftLabel,
    timeRatio,
    trend: clamp((bets / 10) + (1 / Math.max(option.odds, 1)) + (1 - timeRatio), 0, 3),
    bets,
    selection: option.selection,
    endsAt,
  }))
}

type RoundFilter = {
  id: string
  label: string
  predicate: (entry: RoundSelectionEntry) => boolean
}

function createFilters(entries: RoundSelectionEntry[]): RoundFilter[] {
  const filters: RoundFilter[] = [{ id: 'all', label: 'All', predicate: () => true }]
  const maxBets = entries.reduce((max, entry) => Math.max(max, entry.bets), 0)
  if (maxBets > 0) {
    filters.push({
      id: 'popular',
      label: 'Popular',
      predicate: (entry) => entry.bets >= Math.max(2, Math.floor(maxBets * 0.6)),
    })
  }
  const closingSoonThreshold = 0.75
  if (entries.some((entry) => entry.timeRatio >= closingSoonThreshold)) {
    filters.push({
      id: 'closing',
      label: 'Closing Soon',
      predicate: (entry) => entry.timeRatio >= closingSoonThreshold,
    })
  }
  const highOddsThreshold = entries.reduce((sum, entry) => sum + entry.odds, 0) / Math.max(entries.length, 1)
  if (entries.some((entry) => entry.odds >= highOddsThreshold)) {
    filters.push({
      id: 'high-odds',
      label: 'High Odds',
      predicate: (entry) => entry.odds >= highOddsThreshold,
    })
  }
  const types = Array.from(new Set(entries.map((entry) => entry.round.market.type)))
  types.forEach((type) => {
    filters.push({
      id: `type:${type}`,
      label: humanizeMarketType(type),
      predicate: (entry) => entry.round.market.type === type,
    })
  })
  return filters
}

export function RoundsPage() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const navigate = useNavigate()

  const fetchRounds = useCallback(async () => {
    try {
      setError('')
      const data = await roundsService.getActiveRounds()
      setRounds(data)
    } catch (err) {
      console.error(err)
      setError('Unable to load rounds')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRounds()
    const interval = window.setInterval(fetchRounds, 15000)
    return () => window.clearInterval(interval)
  }, [fetchRounds])

  const entries = useMemo(() => {
    const active = rounds.filter((round) => {
      if (round.status !== 'PREDICTING') return false
      const baseAt = round.scheduledReleaseAt || round.openedAt
      if (!baseAt) return false
      const opened = new Date(baseAt).getTime()
      const now = Date.now()
      const timeLeft = opened + ROUND_DURATION_MS - now
      
      return timeLeft > 0
    })
    return active.flatMap((round) => buildSelectionEntries(round))
  }, [rounds])

  const filters = useMemo(() => createFilters(entries), [entries])

  useEffect(() => {
    if (!filters.find((filter) => filter.id === activeFilter)) {
      setActiveFilter(filters[0]?.id ?? 'all')
    }
  }, [activeFilter, filters])

  const filteredEntries = useMemo(() => {
    const selected = filters.find((filter) => filter.id === activeFilter) ?? filters[0]
    return entries.filter(selected?.predicate ?? (() => true))
  }, [activeFilter, entries, filters])

  const startingSoonRounds = useMemo(() => {
    const now = Date.now()
    const twoMinutesMs = 2 * 60 * 1000

    const queued = rounds.filter((round) => round.status === 'QUEUED')
    console.log('All rounds:', rounds.length, 'Queued rounds:', queued.length)

    return rounds.filter((round) => {
      if (round.status !== 'QUEUED') return false
      if (!round.scheduledReleaseAt) return false

      const scheduledTime = new Date(round.scheduledReleaseAt).getTime()
      const timeUntilStart = scheduledTime - now

      return timeUntilStart > 0 && timeUntilStart <= twoMinutesMs
    })
  }, [rounds])

  if (loading) {
    return <div className="dashboard-panel">Loading live rounds…</div>
  }

  if (error) {
    return (
      <div className="dashboard-panel">
        <p>{error}</p>
        <button className="btn" onClick={fetchRounds}>Retry</button>
      </div>
    )
  }

  return (
    <div className="dashboard-panel dashboard-panel-split">
      <div className="dashboard-panel-header">
        <h1 className="dashboard-title">Live Rounds</h1>
        <button className="btn" onClick={fetchRounds}>Refresh</button>
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

      {startingSoonRounds.length > 0 && (
        <div className="starting-soon-section">
          <div className="starting-soon-header">
            <RollingDice />
            <h2 className="starting-soon-title">Starting Soon</h2>
            <span className="starting-soon-subtitle">{startingSoonRounds.length} {startingSoonRounds.length === 1 ? 'round' : 'rounds'} about to begin</span>
          </div>
          <div className="starting-soon-grid">
            {startingSoonRounds.map((round) => {
              const scheduledTime = new Date(round.scheduledReleaseAt!).getTime()
              const timeUntilStart = scheduledTime - Date.now()
              const seconds = Math.floor(timeUntilStart / 1000)
              const minutes = Math.floor(seconds / 60)
              const remainingSeconds = seconds % 60

              return (
                <div key={round.id} className="starting-soon-card">
                  <div className="starting-soon-card-header">
                    <span className="dashboard-round-market-type">{humanizeMarketType(round.market.type)}</span>
                    <div className="starting-soon-pulse"></div>
                  </div>
                  <h3 className="starting-soon-card-title">{round.market.name}</h3>
                  <p className="dashboard-round-meta">Round #{round.roundNumber}</p>
                  <div className="starting-soon-timer">
                    <span className="starting-soon-time">{minutes}:{remainingSeconds.toString().padStart(2, '0')}</span>
                    <span className="starting-soon-label">until start</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {filteredEntries.length === 0 ? (
        <div className="dashboard-empty">No bets match this filter right now.</div>
      ) : (
        <div className="dashboard-round-grid">
          {filteredEntries.map((entry) => (
            <button
              key={entry.id}
              className="card dashboard-round-card"
              style={{ 
                background: entry.accent.bg,
                borderColor: entry.accent.border
              }}
              onClick={() => navigate(`/app/rounds/${entry.round.id}`, { state: { selection: entry.selection, highlight: entry.id } })}
            >
              <div className="dashboard-round-card-header">
                <span className="dashboard-round-market-type">{humanizeMarketType(entry.round.market.type)}</span>
                <div style={{ width: '100px', height: '28px' }}>
                  <TrendChart value={entry.trend} color={entry.accent.chart} height={28} />
                </div>
              </div>
              <h2 className="dashboard-round-card-title">{entry.label}</h2>
              <p className="dashboard-round-meta">Round #{entry.round.roundNumber}</p>
              <div className="dashboard-round-stats">
                <div>
                  <span className="dashboard-round-stat-label">Odds</span>
                  <strong className="dashboard-round-odds-bold" style={{ color: entry.accent.chart }}>{entry.odds.toFixed(entry.odds >= 10 ? 1 : 2)}x</strong>
                  {entry.coverage ? <span className="dashboard-round-coverage">{entry.coverage} coverage</span> : null}
                </div>
                <div>
                  <CountdownTimer endsAt={entry.endsAt} compact showIcon={false} />
                </div>
              </div>
              <div className="dashboard-round-footer">
                <span className="dashboard-round-bets">{entry.bets} bets</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
