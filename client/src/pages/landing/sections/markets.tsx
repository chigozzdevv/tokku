import { motion } from 'framer-motion'
import { Section, SectionHeader } from '@/components/ui/section'
import { useEffect, useMemo, useState, useRef } from 'react'

type MarketType = 'range' | 'parity' | 'last-digit' | 'modulo-3' | 'pattern' | 'shape-color' | 'jackpot' | 'community-seed' | 'entropy-battle' | 'streak-meter'

type TrendType = 'hot' | 'cold' | 'neutral'

type BetOption = {
  id: string
  label: string
  description: string
  odds: number
  coverage: string
  trend: TrendType
  trendValue: string
  popularity: number
}

type MarketData = {
  type: MarketType
  name: string
  description: string
  options: BetOption[]
}

// Build odds dynamically from server markets (houseEdgeBps). Falls back to 2% if not set.
type ServerMarket = { id: string; name: string; type: string; config: any };

function edgeFactorFromBps(bps?: number) {
  const e = Math.max(0, Math.min(10000, bps ?? 200));
  return 10000 / (10000 + e);
}

function to2(x: number) { return Math.round(x * 100) / 100; }

function fromEqualBins(n: number, ef: number) { return to2(n * ef); }
function fromProbability(num: number, den: number, ef: number) {
  if (!num || !den) return 0;
  return to2((den / num) * ef);
}

function buildMarketsData(markets: ServerMarket[]): MarketData[] {
  // map server types to our tabs
  const byType = new Map<string, ServerMarket[]>();
  for (const m of markets) {
    const arr = byType.get(m.type) || [];
    arr.push(m);
    byType.set(m.type, arr);
  }

  const anyOfType = (t: string) => (byType.get(t) || [])[0];
  const ef = (bps?: number) => edgeFactorFromBps(bps);

  const rangeMarkets = byType.get('PICK_RANGE') || [];
  const r2 = rangeMarkets.find(m => m.config?.partitionCount === 2);
  const r4 = rangeMarkets.find(m => m.config?.partitionCount === 4);
  const r10 = rangeMarkets.find(m => m.config?.partitionCount === 10);
  const rangeEf2 = ef(r2?.config?.houseEdgeBps);
  const rangeEf4 = ef(r4?.config?.houseEdgeBps);
  const rangeEf10 = ef(r10?.config?.houseEdgeBps);
  const rangeEfAny = rangeEf10 || rangeEf4 || rangeEf2 || ef(undefined);
  const parityEf = ef(anyOfType('EVEN_ODD')?.config?.houseEdgeBps);
  const lastDigitEf = ef(anyOfType('LAST_DIGIT')?.config?.houseEdgeBps);
  const moduloEf = ef(anyOfType('MODULO_THREE')?.config?.houseEdgeBps);
  const jackpotEf = ef(anyOfType('JACKPOT')?.config?.houseEdgeBps);
  const entropyEf = ef(anyOfType('ENTROPY_BATTLE')?.config?.houseEdgeBps);
  const patternEf = ef(anyOfType('PATTERN_OF_DAY')?.config?.houseEdgeBps);
  const shapeEf = ef(anyOfType('SHAPE_COLOR')?.config?.houseEdgeBps);
  const communityEf = ef(anyOfType('COMMUNITY_SEED')?.config?.houseEdgeBps);

  const patternCounts = [168, 10, 29, 52, 73, 437, 231]; // prime, fib, square, ends7, pal, even, odd

  const data: MarketData[] = [
    {
      type: 'range',
      name: 'Pick the Range',
      description: 'Choose your range width — tighter range, higher payout',
      options: [
        { id: 'r1', label: '1-50', description: '50 numbers', odds: fromEqualBins(2, rangeEf2), coverage: '50/100', trend: 'hot', trendValue: '+12%', popularity: 78 },
        { id: 'r2', label: '1-25', description: '25 numbers', odds: fromEqualBins(4, rangeEf4), coverage: '25/100', trend: 'neutral', trendValue: '+2%', popularity: 45 },
        { id: 'r3', label: '1-10', description: '10 numbers', odds: fromEqualBins(10, rangeEf10), coverage: '10/100', trend: 'cold', trendValue: '-8%', popularity: 23 },
        { id: 'r4', label: '1-5', description: '5 numbers', odds: fromProbability(5, 100, rangeEfAny), coverage: '5/100', trend: 'hot', trendValue: '+18%', popularity: 52 },
        { id: 'r5', label: 'Single', description: 'Exact number', odds: fromEqualBins(100, rangeEfAny), coverage: '1/100', trend: 'hot', trendValue: '+24%', popularity: 34 },
      ],
    },
    {
      type: 'parity',
      name: 'Even / Odd',
      description: 'Classic 50/50 binary outcome',
      options: [
        { id: 'p1', label: 'Even', description: 'All even numbers', odds: fromEqualBins(2, parityEf), coverage: '50/100', trend: 'hot', trendValue: '+15%', popularity: 89 },
        { id: 'p2', label: 'Odd', description: 'All odd numbers', odds: fromEqualBins(2, parityEf), coverage: '50/100', trend: 'neutral', trendValue: '+3%', popularity: 82 },
      ],
    },
    {
      type: 'last-digit',
      name: 'Last Digit',
      description: 'Predict the final digit of the outcome',
      options: Array.from({ length: 5 }, (_, i) => {
        const lab = ['0','1','2','3','7'][i]
        return { id: `d${lab}`, label: lab, description: `Ends in ${lab}`, odds: fromEqualBins(10, lastDigitEf), coverage: '10/100', trend: i===0||i===4?'hot':i===2?'cold':'neutral', trendValue: i===4?'+22%':i===0?'+18%':i===2?'-12%':'+5%', popularity: [34,28,19,31,67][i] } as BetOption
      }),
    },
    {
      type: 'modulo-3',
      name: 'Modulo-3',
      description: 'Remainder when divided by 3',
      options: [
        { id: 'm0', label: 'Bucket 0', description: 'Divisible by 3', odds: fromEqualBins(3, moduloEf), coverage: '33/100', trend: 'neutral', trendValue: '+4%', popularity: 42 },
        { id: 'm1', label: 'Bucket 1', description: 'Remainder of 1', odds: fromEqualBins(3, moduloEf), coverage: '33/100', trend: 'hot', trendValue: '+11%', popularity: 56 },
        { id: 'm2', label: 'Bucket 2', description: 'Remainder of 2', odds: fromEqualBins(3, moduloEf), coverage: '34/100', trend: 'cold', trendValue: '-7%', popularity: 38 },
      ],
    },
    {
      type: 'jackpot',
      name: 'Jackpot',
      description: 'Guess the exact number for massive payout',
      options: [
        { id: 'j1', label: 'Exact Number', description: 'Pinpoint accuracy required', odds: fromEqualBins(100, jackpotEf), coverage: '1/100', trend: 'hot', trendValue: '+31%', popularity: 92 },
      ],
    },
    {
      type: 'entropy-battle',
      name: 'Entropy Battle',
      description: 'Bet on which entropy source scores highest',
      options: [
        { id: 'e1', label: 'TEE Wins', description: 'Trusted Execution', odds: fromEqualBins(3, entropyEf), coverage: '33/100', trend: 'hot', trendValue: '+19%', popularity: 71 },
        { id: 'e2', label: 'Chain Wins', description: 'Blockchain entropy', odds: fromEqualBins(3, entropyEf), coverage: '33/100', trend: 'neutral', trendValue: '+6%', popularity: 48 },
        { id: 'e3', label: 'Sensor Wins', description: 'External sensor', odds: fromEqualBins(3, entropyEf), coverage: '34/100', trend: 'cold', trendValue: '-9%', popularity: 29 },
      ],
    },
    {
      type: 'pattern',
      name: 'Pattern of the Day',
      description: 'Predict daily special number patterns',
      options: [
        { id: 'pat1', label: 'Prime', description: 'Prime numbers', odds: fromProbability(patternCounts[0], 1000, patternEf), coverage: '168/1000', trend: 'hot', trendValue: '+16%', popularity: 52 },
        { id: 'pat2', label: 'Fibonacci', description: 'Fibonacci sequence', odds: fromProbability(patternCounts[1], 1000, patternEf), coverage: '10/1000', trend: 'neutral', trendValue: '+3%', popularity: 41 },
        { id: 'pat3', label: 'Perfect Square', description: 'Square numbers', odds: fromProbability(patternCounts[2], 1000, patternEf), coverage: '29/1000', trend: 'cold', trendValue: '-5%', popularity: 28 },
        { id: 'pat4', label: 'Palindrome', description: 'Reads same both ways', odds: fromProbability(patternCounts[4], 1000, patternEf), coverage: '73/1000', trend: 'hot', trendValue: '+11%', popularity: 35 },
      ],
    },
    {
      type: 'shape-color',
      name: 'Shape & Color',
      description: 'Visual representation betting',
      options: [
        { id: 'sc1', label: 'Any Red', description: 'Just color', odds: fromProbability(12, 72, shapeEf), coverage: '12/72', trend: 'hot', trendValue: '+14%', popularity: 64 },
        { id: 'sc2', label: 'Blue Square', description: 'Shape + color', odds: fromProbability(3, 72, shapeEf), coverage: '3/72', trend: 'neutral', trendValue: '+1%', popularity: 47 },
        { id: 'sc3', label: 'Small Green Circle', description: 'All attributes', odds: fromProbability(1, 72, shapeEf), coverage: '1/72', trend: 'hot', trendValue: '+9%', popularity: 55 },
      ],
    },
    {
      type: 'streak-meter',
      name: 'Streak Meter',
      description: 'Consecutive wins challenge',
      options: [
        { id: 'str1', label: '3-Win Streak', description: 'Triple victory', odds: 1.4, coverage: 'challenge', trend: 'hot', trendValue: '+21%', popularity: 76 },
        { id: 'str2', label: '5-Win Streak', description: 'Five in a row', odds: 4, coverage: 'challenge', trend: 'neutral', trendValue: '+7%', popularity: 58 },
        { id: 'str3', label: '10-Win Streak', description: 'Perfect ten', odds: 30, coverage: 'challenge', trend: 'cold', trendValue: '-3%', popularity: 15 },
      ],
    },
    {
      type: 'community-seed',
      name: 'Community Seed',
      description: 'Collaborative entropy generation',
      options: [
        { id: 'cs1', label: 'Distance ≤2', description: 'Close match', odds: fromProbability(1+8+28, 256, communityEf), coverage: '37/256', trend: 'hot', trendValue: '+18%', popularity: 81 },
        { id: 'cs2', label: 'Distance ≤1', description: 'Very close', odds: fromProbability(1+8, 256, communityEf), coverage: '9/256', trend: 'neutral', trendValue: '+12%', popularity: 62 },
        { id: 'cs3', label: 'Exact Byte', description: 'Perfect match', odds: fromProbability(1, 256, communityEf), coverage: '1/256', trend: 'hot', trendValue: '+4%', popularity: 39 },
      ],
    },
  ]

  return data
}

const MARKET_TABS: { key: MarketType; label: string }[] = [
  { key: 'range', label: 'Range' },
  { key: 'parity', label: 'Parity' },
  { key: 'last-digit', label: 'Last Digit' },
  { key: 'modulo-3', label: 'Modulo-3' },
  { key: 'pattern', label: 'Pattern' },
  { key: 'shape-color', label: 'Shape & Color' },
  { key: 'jackpot', label: 'Jackpot' },
  { key: 'streak-meter', label: 'Streak Meter' },
  { key: 'entropy-battle', label: 'Entropy Battle' },
  { key: 'community-seed', label: 'Community' },
]

 

function BetOptionCard({ option, index }: { option: BetOption; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      whileHover={{
        borderColor: 'color-mix(in oklab, var(--accent) 40%, var(--border))',
        y: -4,
      }}
      transition={{ duration: 0.28, delay: index * 0.03 }}
      className="card option-card"
      style={{
        padding: '1.25rem',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        alignSelf: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {/* Trend Badge - subtle corner indicator */}
      <div style={{
        position: 'absolute',
        top: '0.75rem',
        right: '0.75rem',
        fontSize: '0.8rem',
        color: option.trend === 'hot' ? 'var(--accent)' : option.trend === 'cold' ? '#f87171' : 'var(--muted)',
        fontWeight: 600,
      }}>
        {option.trendValue}
      </div>

      {/* Label */}
      <div>
        <h3 style={{
          margin: 0,
          fontSize: '1.3rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
        }}>
          {option.label}
        </h3>
        <p style={{
          margin: '0.3rem 0 0 0',
          fontSize: '0.8rem',
          color: 'var(--muted)',
        }}>
          {option.description}
        </p>
      </div>

      {/* Payout - Hero Element */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        <div style={{
          fontSize: '2.5rem',
          fontWeight: 900,
          color: 'var(--accent)',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}>
          {option.odds}x
        </div>
      </div>

      {/* Bottom Info - Minimal */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: '0.75rem',
        borderTop: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
          {option.coverage}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 }}>
          {option.popularity}% pick
        </span>
      </div>
    </motion.div>
  )
}

// inline carousel controls handled in MarketsSection

export function MarketsSection() {
  const [activeTab, setActiveTab] = useState<MarketType>('range')
  const [marketsData, setMarketsData] = useState<MarketData[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/markets')
        const json = await res.json()
        const items: ServerMarket[] = json?.data || []
        if (!cancelled) setMarketsData(buildMarketsData(items))
      } catch {
        // fallback: assume defaults with 2% edge
        if (!cancelled) setMarketsData(buildMarketsData([]))
      }
    })()
    return () => { cancelled = true }
  }, [])
  const trackRef = useRef<HTMLDivElement | null>(null)
  const scrollByCards = (dir: 1 | -1) => {
    const trackEl = trackRef.current
    if (!trackEl) return
    const card = trackEl.querySelector<HTMLDivElement>('.option-card')
    const cardWidth = card ? (card.getBoundingClientRect().width + 12) : 280
    const visible = Math.max(1, Math.floor(trackEl.clientWidth / cardWidth))
    const delta = cardWidth * visible * dir
    trackEl.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const activeMarket = useMemo(() => (marketsData || buildMarketsData([])).find(m => m.type === activeTab), [marketsData, activeTab])

  return (
    <Section id="markets">
      <div className="container">
        <SectionHeader title="Markets" sub="Explore odds and betting options across all market types" />

        {/* Tabs row */}
        <div className="markets-header-row">
          <nav className="markets-tabs-horizontal" role="tablist" aria-label="Market types">
            {MARKET_TABS.map(tab => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={isActive}
                  className={`market-tab ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                  title={tab.label}
                >
                  <div className="market-tab-title">{tab.label}</div>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Active market header removed per request */}

        {/* Options carousel with aligned controls */}
        {activeMarket && (
          <div className="markets-carousel">
            <button className="carousel-btn prev" aria-label="Previous" onClick={() => scrollByCards(-1)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div className="carousel-track" ref={trackRef}>
              {activeMarket.options.map((option, idx) => (
                <BetOptionCard key={option.id} option={option} index={idx} />
              ))}
            </div>
            <button className="carousel-btn next" aria-label="Next" onClick={() => scrollByCards(1)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        )}

        <div className="markets-layout" style={{ display: 'none' }}>
          {/* Left Column - Market Types */}
          <div>
            <div className="card markets-sidebar">
              <h3 style={{ 
                margin: '0 0 1rem 0', 
                fontSize: '0.85rem', 
                fontWeight: 700, 
                textTransform: 'uppercase', 
                letterSpacing: '0.05em',
                color: 'var(--muted)',
              }}>
                Market Types
              </h3>
              <nav className="markets-tabs" role="tablist" aria-label="Market types">
                {MARKET_TABS.map(tab => {
                  const isActive = activeTab === tab.key
                  return (
                    <button
                      key={tab.key}
                      role="tab"
                      aria-selected={isActive}
                      className={`market-tab ${isActive ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      <div className="market-tab-title">
                        {tab.label}
                      </div>
                    </button>
                  )
                })}
              </nav>
            </div>
          </div>

          {/* Right Column - Bet Options Grid */}
          <div>
            {activeMarket && (
              <>
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
                    {activeMarket.name}
                  </h3>
                  <p className="meta" style={{ margin: '0.5rem 0 0 0', fontSize: '0.95rem' }}>
                    {activeMarket.description}
                  </p>
                </div>

        <div className="markets-options-grid">
                  {activeMarket.options.map((option, idx) => (
                    <BetOptionCard key={option.id} option={option} index={idx} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}
