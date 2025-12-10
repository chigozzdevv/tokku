import { Card } from '@/components/ui/card'
import { Section, SectionHeader } from '@/components/ui/section'
import { motion } from 'framer-motion'

export function FeaturesSection() {
  return (
    <Section id="features">
      <div className="container">
        <SectionHeader title="Why Tossr" sub="Provable randomness, transparent odds, and streamlined UX" />
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.35 }} style={{ flex: '1 1 260px' }}>
            <Card>
              <h3 style={{ marginTop: 0 }}>Provable randomness</h3>
              <p className="section-sub">Every outcome is verifiable on-chain with attestations.</p>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.35, delay: .08 }} style={{ flex: '1 1 260px' }}>
            <Card>
              <h3 style={{ marginTop: 0 }}>Fast settlements</h3>
              <p className="section-sub">Rounds finalize quickly with clear, auditable states.</p>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.35, delay: .16 }} style={{ flex: '1 1 260px' }}>
            <Card>
              <h3 style={{ marginTop: 0 }}>Community pools</h3>
              <p className="section-sub">Join or create markets and share in fees.</p>
            </Card>
          </motion.div>
        </div>
      </div>
    </Section>
  )
}
