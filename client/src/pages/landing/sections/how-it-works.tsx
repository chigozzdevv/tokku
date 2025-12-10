import { Card } from '@/components/ui/card'
import { Section, SectionHeader } from '@/components/ui/section'
import { motion } from 'framer-motion'

const steps = [
  { key: 'open', title: 'Open Round' },
  { key: 'delegate', title: 'Delegate' },
  { key: 'bet', title: 'Place Bets' },
  { key: 'lock', title: 'Lock' },
  { key: 'generate', title: 'Generate' },
  { key: 'commit', title: 'Commit' },
  { key: 'reveal', title: 'Reveal' },
  { key: 'settle', title: 'Settle' },
]

const phases = [
  {
    key: 'prepare',
    title: 'Round Setup',
    sub: 'Initialize round, request randomness, collect bets',
    items: [
      'New round opens automatically on Tossr Engine',
      'MagicBlock ER queues a VRF request for the round',
      'Players place SOL bets via delegated accounts',
      'Round locks when the countdown expires'
    ],
    chips: ['Solana', 'MagicBlock ER', 'MagicBlock VRF']
  },
  {
    key: 'prove',
    title: 'Attested Generation',
    sub: 'PER enclave executes outcome logic with sealed inputs',
    items: [
      'MagicBlock VRF returns 32-byte randomness to the enclave',
      'PER runtime computes market outcome from randomness + inputs',
      'Enclave signs an attestation with measurement & inputs hash',
      'Commitment recorded inside ER and mirrored to Solana'
    ],
    chips: ['MagicBlock PER', 'Attestation']
  },
  {
    key: 'settle',
    title: 'Settlement',
    sub: 'Reveal, verify and settle on Solana',
    items: [
      'PER reveals the outcome alongside its attestation',
      'Solana program verifies randomness, signature and commitment',
      'Each bet is evaluated and payouts stream in SOL',
      'Round state anchors back to the base layer ledger'
    ],
    chips: ['Verifier', 'SOL Payouts']
  },
]

export function HowItWorksSection() {
  return (
    <Section id="how-it-works">
      <div className="container">
        <SectionHeader title="How it works" sub="Provably fair betting powered by MagicBlock PER, VRF and Solana" />
        <div className="how-v3">
          <div className="process-rail">
            <div className="rail-line" aria-hidden />
            <div className="rail-nodes">
              {steps.map((s, i) => (
                <div key={s.key} className="rail-node">
                  <span className="dot"><span className="pulse" /></span>
                  <span className="label">{i + 1}. {s.title}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="phase-grid">
            {phases.map((p, idx) => (
              <motion.div key={p.key} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.35 }} transition={{ duration: 0.28, delay: idx * 0.05 }}>
                <Card className="phase-card">
                  <div className="phase-head">
                    <strong>{p.title}</strong>
                    <div className="chip-grid">
                      {p.chips.map((c, i) => (
                        <span key={i} className={c.includes('MagicBlock') ? 'chip chip-accent' : 'chip'}>{c}</span>
                      ))}
                    </div>
                  </div>
                  <div className="phase-sub meta">{p.sub}</div>
                  <ul className="phase-list">
                    {p.items.map((it, i) => (<li key={i}>{it}</li>))}
                  </ul>
                </Card>
              </motion.div>
            ))}
          </div>
          
        </div>
      </div>
    </Section>
  )
}
