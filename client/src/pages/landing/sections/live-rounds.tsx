import { Section, SectionHeader } from '@/components/ui/section'
import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { roundsService, type Round } from '@/services/rounds.service'

const DEFAULT_ROUND_DURATION_SECONDS = Number(import.meta.env.VITE_ROUND_DURATION_SECONDS ?? 600)
const ROUND_DURATION_MS = DEFAULT_ROUND_DURATION_SECONDS * 1000

const MARKET_DESCRIPTIONS: Record<string, string> = {
  PICK_RANGE: 'Pick a range of numbers',
  EVEN_ODD: 'Predict even or odd',
  LAST_DIGIT: 'Predict the last digit',
  MODULO_THREE: 'Result modulo 3',
  PATTERN_OF_DAY: 'Daily pattern match',
  SHAPE_COLOR: 'Shape and color combo',
  JACKPOT: 'High-risk, high-reward',
  ENTROPY_BATTLE: 'TEE vs Chain entropy',
  STREAK_METER: 'Build your streak',
  COMMUNITY_SEED: 'Community-driven outcome'
}

type RoundOption = {
  id: string
  label: string
  odds: number
  coverage?: string
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const asNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

const toConfigObject = (config: unknown): Record<string, any> => {
  if (!config) return {}
  if (typeof config === 'string') {
    try {
      return JSON.parse(config)
    } catch {
      return {}
    }
  }
  if (typeof config === 'object') return config as Record<string, any>
  return {}
}

const formatOdds = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '1.00'
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

const buildRoundOptions = (round: Round): RoundOption[] => {
  const config = toConfigObject(round.market.config)
  const houseEdgeBps = clamp(asNumber(config.houseEdgeBps, 0), 0, 10000)
  const edgeFactor = 10000 / (10000 + houseEdgeBps)
  const fromEqualBins = (n: number) => Math.max(1, Math.floor(n * edgeFactor * 100) / 100)
  const fromProbability = (num: number, den: number) => {
    if (!num || !den) return 0
    const val = (den / num) * edgeFactor
    return Math.max(1, Math.floor(val * 100) / 100)
  }

  switch (round.market.type) {
    case 'PICK_RANGE': {
      const partitions = Math.max(1, Math.min(20, Math.floor(asNumber(config.partitionCount, 2))))
      const options: RoundOption[] = []
      const baseWidth = Math.floor(100 / partitions)
      let start = 1
      for (let i = 0; i < partitions; i++) {
        const isLast = i === partitions - 1
        const end = isLast ? 100 : Math.min(100, start + baseWidth - 1)
        const span = end - start + 1
        options.push({
          id: `range-${i}`,
          label: `${start}-${end}`,
          odds: fromProbability(span, 100),
          coverage: `${span}/100`
        })
        start = end + 1
      }
      return options.length ? options : [{ id: 'range-fallback', label: 'Any Range', odds: fromEqualBins(2), coverage: '50/100' }]
    }

    case 'EVEN_ODD':
      return [
        { id: 'even', label: 'Even', odds: fromEqualBins(2), coverage: '50/100' },
        { id: 'odd', label: 'Odd', odds: fromEqualBins(2), coverage: '50/100' }
      ]

    case 'LAST_DIGIT':
      return Array.from({ length: 10 }, (_, digit) => ({
        id: `digit-${digit}`,
        label: `${digit}`,
        odds: fromEqualBins(10),
        coverage: '10/100'
      }))

    case 'MODULO_THREE':
      return [0, 1, 2].map((value) => ({
        id: `mod-${value}`,
        label: `Remainder ${value}`,
        odds: fromEqualBins(3),
        coverage: '≈33/100'
      }))

    case 'PATTERN_OF_DAY': {
      const counts = [168, 10, 29, 52, 73, 437, 231]
      const labels = ['Prime', 'Fibonacci', 'Perfect Square', 'Ends in 7', 'Palindrome', 'Even', 'Odd']
      return counts.map((count, idx) => ({
        id: `pattern-${idx}`,
        label: labels[idx] || `Pattern ${idx + 1}`,
        odds: fromProbability(count, 1000),
        coverage: `${count}/1000`
      }))
    }

    case 'SHAPE_COLOR':
      return [
        { id: 'color', label: 'Match Color', odds: fromProbability(12, 72), coverage: '12/72' },
        { id: 'shape-color', label: 'Match Shape & Color', odds: fromProbability(3, 72), coverage: '3/72' },
        { id: 'full', label: 'Exact Shape + Color + Size', odds: fromProbability(1, 72), coverage: '1/72' }
      ]

    case 'JACKPOT':
      return [{ id: 'jackpot', label: 'Exact Match', odds: fromEqualBins(100), coverage: '1/100' }]

    case 'ENTROPY_BATTLE':
      return [
        { id: 'tee', label: 'TEE Wins', odds: fromEqualBins(3), coverage: '≈33/100' },
        { id: 'chain', label: 'Chain Wins', odds: fromEqualBins(3), coverage: '≈33/100' },
        { id: 'sensor', label: 'Sensor Wins', odds: fromEqualBins(3), coverage: '≈33/100' }
      ]

    case 'STREAK_METER': {
      const targets = [3, 5, 10]
      return targets.map((target) => {
        const denominator = Math.pow(2, target)
        return {
          id: `streak-${target}`,
          label: `${target}-Win Streak`,
          odds: fromProbability(1, denominator),
          coverage: `1/${denominator}`
        }
      })
    }

    case 'COMMUNITY_SEED': {
      const choose = (n: number, k: number) => {
        if (k < 0 || k > n) return 0
        let numer = 1
        let denom = 1
        for (let i = 0; i < k; i++) {
          numer *= (n - i)
          denom *= (i + 1)
        }
        return Math.floor(numer / denom)
      }

      const toleranceCounts = (tolerance: number) => {
        let total = 0
        for (let k = 0; k <= tolerance; k++) total += choose(8, k)
        return total
      }

      const options: RoundOption[] = [
        { id: 'tol-2', label: 'Distance ≤ 2', odds: fromProbability(toleranceCounts(2), 256), coverage: `${toleranceCounts(2)}/256` },
        { id: 'tol-1', label: 'Distance ≤ 1', odds: fromProbability(toleranceCounts(1), 256), coverage: `${toleranceCounts(1)}/256` },
        { id: 'tol-0', label: 'Exact Byte', odds: fromProbability(1, 256), coverage: '1/256' }
      ]

      return options
    }

    default:
      return [
        { id: 'default-a', label: 'Option A', odds: fromEqualBins(2), coverage: '50/100' },
        { id: 'default-b', label: 'Option B', odds: fromEqualBins(2), coverage: '50/100' }
      ]
  }
}

const formatCountdown = (seconds: number | null | undefined) => {
  if (seconds == null) return 'TBD'
  if (seconds <= 0) return 'Closing'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toString().padStart(2, '0')}s`
}

export function LiveRoundsSection() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const fetchLiveRounds = useCallback(async () => {
    try {
      setError(null)
      const data = await roundsService.getActiveRounds()
      setRounds(data.filter((round) => round.status === 'PREDICTING'))
    } catch (err) {
      console.error('Failed to fetch live rounds:', err)
      setError('Failed to load rounds')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLiveRounds()
    const interval = setInterval(fetchLiveRounds, 10000)
    return () => clearInterval(interval)
  }, [fetchLiveRounds])

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(ticker)
  }, [])

  const activeRounds = useMemo(() => {
    return rounds
      .map((round) => {
        const baseAtStr = round.scheduledReleaseAt || round.openedAt
        const baseAt = baseAtStr ? new Date(baseAtStr).getTime() : null
        const endsAt = baseAt ? baseAt + ROUND_DURATION_MS : null
        const timeLeftSeconds = endsAt ? Math.max(0, Math.floor((endsAt - now) / 1000)) : null
        return { round, openedAt: baseAt, endsAt, timeLeftSeconds }
      })
      .sort((a, b) => (a.endsAt ?? Number.MAX_SAFE_INTEGER) - (b.endsAt ?? Number.MAX_SAFE_INTEGER))
  }, [rounds, now])

  const displayEntries = useMemo(() => {
    return activeRounds
      .map(({ round, timeLeftSeconds }) => ({ round, timeLeftSeconds }))
      .filter(({ round, timeLeftSeconds }) => {
        if (!round || !round.market || !round.market.name) return false
        if (timeLeftSeconds !== null && timeLeftSeconds <= 0) return false
        return true
      })
      .slice(0, 8)
  }, [activeRounds])

  const nextEndIn = displayEntries[0]?.timeLeftSeconds ?? null

  if (loading) {
    return (
      <Section id="live-rounds">
        <div className="container">
          <SectionHeader title="Live Rounds" sub="Upcoming and active betting rounds" />
          <div style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--muted)' }}>
            Loading rounds...
          </div>
        </div>
      </Section>
    )
  }

  if (error) {
    return (
      <Section id="live-rounds">
        <div className="container">
          <SectionHeader title="Live Rounds" sub="Upcoming and active betting rounds" />
          <div style={{ padding: '4rem 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
              {error}
            </p>
            <button onClick={fetchLiveRounds} className="btn btn-primary">
              Try Again
            </button>
          </div>
        </div>
      </Section>
    )
  }

  return (
    <Section id="live-rounds">
      <div className="container">
        <SectionHeader
          title="Live Rounds"
          sub="Queue up for upcoming releases or jump into active rounds"
        />

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.25rem' }}>
          <div style={{
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '1rem 1.25rem',
            maxWidth: '280px',
            width: '100%',
            textAlign: 'center',
            background: 'color-mix(in oklab, var(--accent) 4%, transparent)'
          }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
              Current round ends in
            </span>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.35rem', color: 'var(--accent)' }}>
              {formatCountdown(nextEndIn)}
            </div>
          </div>
        </div>

        {displayEntries.length === 0 && (
          <div style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--muted)' }}>
            No active rounds right now. Check back soon.
          </div>
        )}

        {displayEntries.length > 0 && (
          <div
            className="live-round-grid"
            style={{
              marginTop: '1.5rem'
            }}
          >
            {displayEntries.map((entry, idx) => {
              const { round } = entry
              const indicatorLabel = 'Ends in'
              const countdownValue = entry.timeLeftSeconds
              const indicatorValue = formatCountdown(countdownValue)
              const description = MARKET_DESCRIPTIONS[round.market.type] || 'Place your bet'
              const options = buildRoundOptions(round).slice(0, 3)
              const tagText = 'Live'
              const tagBackground = 'color-mix(in oklab, var(--accent) 32%, transparent)'
              const openedTime = (round.scheduledReleaseAt || round.openedAt)
                ? new Date(round.scheduledReleaseAt || round.openedAt as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : null

              return (
                <motion.div
                  key={`${round.id}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.28, delay: idx * 0.05 }}
                  className="card"
                  style={{
                    padding: '1.25rem',
                    minHeight: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    transition: 'all 0.2s ease'
                  }}
                  whileHover={{
                    y: -4,
                    borderColor: 'color-mix(in oklab, var(--accent) 30%, var(--border))'
                  }}
                >
                  <div>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '0.75rem',
                      gap: '0.5rem'
                    }}>
                      <div style={{ flex: 1 }}>
                        <h3 style={{
                          margin: 0,
                          fontSize: '1.125rem',
                          fontWeight: 700,
                          letterSpacing: '-0.02em'
                        }}>
                          {round.market.name}
                        </h3>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                          Round #{round.roundNumber}
                        </span>
                      </div>
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '999px',
                        color: 'var(--accent)',
                        background: tagBackground
                      }}>
                        {tagText}
                      </span>
                    </div>

                    <p style={{
                      margin: '0 0 1rem 0',
                      fontSize: '0.9rem',
                      color: 'var(--muted)',
                      lineHeight: 1.5
                    }}>
                      {description}
                    </p>

                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.65rem 0.75rem',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      background: 'color-mix(in oklab, var(--accent) 8%, transparent)'
                    }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)' }}>
                        {indicatorLabel}
                      </span>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent)' }}>
                        {indicatorValue}
                      </span>
                    </div>

                    {openedTime && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
                        Opened at {openedTime}
                      </div>
                    )}

                    <div style={{
                      marginTop: '1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem'
                    }}>
                      {options.map((option) => (
                        <div
                          key={option.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto auto',
                            gap: '0.5rem',
                            alignItems: 'center',
                            padding: '0.55rem 0.75rem',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            background: 'color-mix(in oklab, var(--accent) 4%, transparent)'
                          }}
                        >
                          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{option.label}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{option.coverage}</span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{formatOdds(option.odds)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{
                    marginTop: 'auto',
                    fontSize: '0.8rem',
                    color: 'var(--muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span>{round._count?.bets ?? 0} bets</span>
                    <span>{round.market.type.replace(/_/g, ' ')}</span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <a
            href="/app"
            className="chip chip-accent"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.75rem 1.5rem',
              fontWeight: 600,
              minWidth: '160px',
              textDecoration: 'none'
            }}
          >
            View all rounds →
          </a>
        </div>

      </div>
    </Section>
  )
}
