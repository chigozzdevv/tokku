import { Navbar } from '../../components/ui/navbar'
import { Hero } from './sections/hero'
import { HowItWorksSection } from './sections/how-it-works'
import { MarketsSection } from './sections/markets'
import { LiveRoundsSection } from './sections/live-rounds'
import { FaqSection } from './sections/faq'
import { Section, SectionDivider } from '../../components/ui/section'
import { Button } from '../../components/ui/button'

export function LandingPage() {
  return (
    <div>
      <Navbar />
      <main>
        <Hero />
        <SectionDivider />
        <HowItWorksSection />
        <SectionDivider />
        <MarketsSection />
        <SectionDivider />
        <LiveRoundsSection />
        <SectionDivider />
        <FaqSection />
        <SectionDivider />
        <Section id="get-started">
          <div className="container" style={{ textAlign: 'center', padding: '4rem 0' }}>
            <h2 className="section-title" style={{ marginBottom: '1rem' }}>
              Ready to bet on attested randomness?
            </h2>
            <p className="section-sub" style={{ maxWidth: '560px', margin: '0 auto 2rem' }}>
              Launch Tokku, connect your wallet, and play SOL markets secured by MagicBlock PER + VRF proofs.
            </p>
            <div className="row row-center" style={{ marginTop: '2.25rem', gap: '1rem' }}>
              <Button variant="primary" style={{ padding: '0.95rem 2.4rem', fontSize: '1rem' }}>
                Connect Wallet
              </Button>
              <a className="btn" href="#markets" style={{ padding: '0.95rem 2.4rem' }}>
                Explore Markets
              </a>
            </div>
          </div>
        </Section>
      </main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <img src="/tokku-logo.png" alt="Tokku" style={{ height: '64px', width: 'auto' }} />
          </div>
          <nav className="footer-nav">
            <a href="#how-it-works">How it works</a>
            <a href="#markets">Markets</a>
            <a href="#live-rounds">Rounds</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="footer-legal">
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
