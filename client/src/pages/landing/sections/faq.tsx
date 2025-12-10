import { Section, SectionHeader } from '@/components/ui/section'
import { motion } from 'framer-motion'
import { useState } from 'react'

type FaqItem = {
  question: string
  answer: string
}

const faqs: FaqItem[] = [
  {
    question: 'How does Tossr ensure fair outcomes?',
    answer: 'Tossr combines MagicBlock VRF randomness with a Private Ephemeral Rollup (PER) enclave. The enclave executes the outcome logic, signs an attestation with its measurement and inputs hash, and anchors that commitment to Solana before any reveal. Because the proof is sealed in hardware, results cannot be altered after bets lock.'
  },
  {
    question: 'What makes betting on Tossr different?',
    answer: 'Unlike Web2 books, Tossr settles rounds with on-chain programs that verify PER attestations and VRF transcripts. Every market uses the same SOL vaults, and anyone can inspect the randomness, enclave measurement, and settlement transaction directly on Solana.'
  },
  {
    question: 'How fast are payouts?',
    answer: 'Payouts are processed automatically by smart contracts immediately after outcome verification. Winners receive tokens directly to their wallets within seconds of round settlement. No manual approval or withdrawal requests needed.'
  },
  {
    question: 'What are the fees?',
    answer: 'Tossr uses MagicBlock Ephemeral Rollups for low-latency execution while anchoring proofs back to Solana. Market-specific house edges are transparently displayed in the odds. There are no hidden fees—what you see is what you get.'
  },
  {
    question: 'Can I verify the randomness?',
    answer: 'Absolutely. Each reveal publishes the VRF output, the PER attestation signature, enclave measurement, and the commitment hash. You can recompute the expected hash and validate the proof against our Solana verifier or the MagicBlock tooling linked above.'
  },
  {
    question: 'What tokens can I use to bet?',
    answer: 'All bets are placed in SOL. Markets specify their SOL requirements, and all payouts are returned in SOL directly to your wallet.'
  },
  {
    question: 'How long do rounds last?',
    answer: 'Round duration varies by market type. Most rounds run for 2-5 minutes with a betting period followed by outcome generation and settlement. Active rounds show a countdown timer.'
  }
]

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)
  const [showAll, setShowAll] = useState(false)

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index)
  }

  const visibleFaqs = showAll ? faqs : faqs.slice(0, 4)

  return (
    <Section id="faq">
      <div className="container">
        <SectionHeader
          title="Frequently Asked Questions"
          sub="Everything you need to know about betting on Tossr"
        />

        <div style={{
          maxWidth: '800px',
          margin: '2rem auto 0',
          display: 'grid',
          gap: '1rem'
        }}>
          {visibleFaqs.map((faq, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.28, delay: index * 0.05 }}
              className="card"
              style={{
                padding: '1.25rem',
                cursor: 'pointer',
                borderColor: openIndex === index ? 'color-mix(in oklab, var(--accent) 30%, var(--border))' : undefined
              }}
              onClick={() => toggleFaq(index)}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '1rem'
              }}>
                <h3 style={{
                  margin: 0,
                  fontSize: '1rem',
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  flex: 1
                }}>
                  {faq.question}
                </h3>
                <span style={{
                  fontSize: '1.25rem',
                  color: 'var(--accent)',
                  transition: 'transform 0.2s ease',
                  transform: openIndex === index ? 'rotate(45deg)' : 'rotate(0deg)',
                  flexShrink: 0
                }}>
                  +
                </span>
              </div>

              <motion.div
                initial={false}
                animate={{
                  height: openIndex === index ? 'auto' : 0,
                  opacity: openIndex === index ? 1 : 0,
                  marginTop: openIndex === index ? '0.75rem' : 0
                }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                style={{
                  overflow: 'hidden'
                }}
              >
                <p style={{
                  margin: 0,
                  fontSize: '0.9rem',
                  lineHeight: 1.6,
                  color: 'var(--muted)'
                }}>
                  {faq.answer}
                </p>
              </motion.div>
            </motion.div>
          ))}

          {!showAll && faqs.length > 4 && (
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button
                onClick={() => setShowAll(true)}
                className="chip chip-accent"
                style={{ padding: '0.75rem 1.5rem', cursor: 'pointer' }}
              >
                View More ({faqs.length - 4} more questions)
              </button>
            </div>
          )}

          {showAll && (
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button
                onClick={() => setShowAll(false)}
                className="chip"
                style={{ padding: '0.75rem 1.5rem', cursor: 'pointer' }}
              >
                Show Less
              </button>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
