export function CommunityPage() {
  return (
    <div className="dashboard-panel dashboard-panel-split">
      <div className="dashboard-panel-header">
        <h1 className="dashboard-title">Community</h1>
      </div>

      <div style={{
        minHeight: '50vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: '2rem',
        padding: '3rem 1.5rem'
      }}>
        <div style={{
          width: '100px',
          height: '100px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(185,246,201,0.15), rgba(185,246,201,0.05))',
          border: '2px solid rgba(185,246,201,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>

        <div style={{ maxWidth: '600px' }}>
          <h2 style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            Community Features Coming Soon
          </h2>
          <p style={{
            fontSize: '1rem',
            color: 'var(--muted)',
            lineHeight: 1.6
          }}>
            We're building powerful community features to enhance your experience. Soon you'll be able to participate in community rounds, share strategies, and connect with other players.
          </p>
        </div>
      </div>
    </div>
  )
}
