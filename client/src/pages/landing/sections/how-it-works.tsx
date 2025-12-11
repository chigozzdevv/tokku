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
    label: 'Phase 1',
    title: 'Round Setup',
    sub: 'Open a round, bind randomness and accept bets.',
    items: [
      'Tokku Engine starts a new round with a countdown.',
      'MagicBlock ER enqueues a VRF request for that round.',
      'Players place SOL bets via delegated accounts until lock.',
    ],
    chips: ['Solana', 'MagicBlock ER', 'MagicBlock VRF'],
  },
  {
    key: 'prove',
    label: 'Phase 2',
    title: 'Attested Generation',
    sub: 'Enclave turns randomness and inputs into outcomes.',
    items: [
      'MagicBlock VRF delivers 32-byte randomness into the enclave.',
      'PER runtime derives market outcomes from randomness + inputs.',
      'Enclave signs an attestation over code measurement and inputs.',
    ],
    chips: ['MagicBlock PER', 'Attestation'],
  },
  {
    key: 'settle',
    label: 'Phase 3',
    title: 'Settlement',
    sub: 'Reveal, verify and pay out on Solana.',
    items: [
      'PER reveals the outcome alongside its attestation.',
      'Solana program verifies randomness, signature and commitment.',
      'Winning bets receive SOL payouts and the round finalizes.',
    ],
    chips: ['Verifier', 'SOL Payouts'],
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
              <motion.div
                key={p.key}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.35 }}
                transition={{ duration: 0.28, delay: idx * 0.05 }}
              >
                <Card className="phase-card card-hover">
                  <div className="phase-head">
                    <div className="phase-title-row">
                      <span className="phase-tag">{p.label}</span>
                      <strong className="phase-title">{p.title}</strong>
                    </div>
                    <div className="phase-sub meta">{p.sub}</div>
                  </div>
                  <ul className="phase-list">
                    {p.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
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
