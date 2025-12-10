import { useRef } from 'react'
import { Section, SectionHeader } from '@/components/ui/section'
import { motion } from 'framer-motion'

type EventItem = {
  id: string
  name: string
  cap: string
  delta: string
  desc: string
  ago: string
  avatars: string[]
}

const data: EventItem[] = [
  {
    id: 'hl',
    name: 'Hyperliquid',
    cap: '10.14B MC',
    delta: '+0.03 (24h)',
    desc: 'AI Models Compete on Hyperliquid, showcasing platform robustness.',
    ago: '34m',
    avatars: ['D','A','M','R','S'],
  },
  {
    id: 'ddp',
    name: 'DOODiPALS',
    cap: '94.24M MC',
    delta: '+0.01 (24h)',
    desc: 'Key leak results in significant token theft; volatility spikes.',
    ago: '35m',
    avatars: ['J','K','Q','T','U'],
  },
  {
    id: 'fil',
    name: 'Filecoin',
    cap: '1.14B MC',
    delta: '+0.02 (24h)',
    desc: 'FIL lags amid downturn; storage auctions continue.',
    ago: '1h',
    avatars: ['X','Y','Z','P','N'],
  },
  {
    id: 'sei',
    name: 'Sei',
    cap: '1.26B MC',
    delta: '+0.01 (24h)',
    desc: 'Hamilton Lane tokenizes Sei network instruments.',
    ago: '1h',
    avatars: ['A','B','C','D','E'],
  },
]

export function MarketEventsSection() {
  const scroller = useRef<HTMLDivElement | null>(null)
  const scrollBy = (dir: number) => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: dir * (el.clientWidth * 0.85), behavior: 'smooth' })
  }
  return (
    <Section id="market-events">
      <div className="container">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <SectionHeader title="Market events" sub="Quick pulse across projects and pools" />
          <div className="row">
            <button className="btn" aria-label="Previous" onClick={() => scrollBy(-1)}>{'‹'}</button>
            <button className="btn" aria-label="Next" onClick={() => scrollBy(1)}>{'›'}</button>
          </div>
        </div>

        <div ref={scroller} className="scroll-row">
          {data.map((e, i) => (
            <motion.article
              key={e.id}
              className="event-card"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              whileHover={{ y: -4, boxShadow: '0 10px 28px rgba(0,0,0,0.35)' }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row" style={{ gap: '.6rem' }}>
                  <div className="icon-blob" aria-hidden>
                    <span>{e.name[0]}</span>
                  </div>
                  <div className="stack-sm">
                    <strong>{e.name}</strong>
                    <span className="meta">{e.cap}</span>
                  </div>
                </div>
                <div className="stack-sm" style={{ alignItems: 'flex-end', textAlign: 'right' }}>
                  <span className="pill pill-up">{e.delta}</span>
                  <Sparkline />
                </div>
              </div>
              <p className="event-desc">{e.desc}</p>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <AvatarStack items={e.avatars} />
                <span className="meta">{e.ago} ago</span>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </Section>
  )
}

function AvatarStack({ items }: { items: string[] }) {
  return (
    <div className="avatar-stack">
      {items.map((t, i) => (
        <div key={i} className="avatar" style={{ zIndex: 20 - i }}>
          {t}
        </div>
      ))}
    </div>
  )
}

function Sparkline() {
  return (
    <svg width="90" height="24" viewBox="0 0 90 24" fill="none" aria-hidden>
      <path d="M1 18 L12 12 L22 14 L33 8 L44 12 L56 6 L68 10 L80 4" stroke="var(--accent)" strokeWidth="2" fill="none" />
    </svg>
  )
}

