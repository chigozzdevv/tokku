import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/providers/auth-provider'
import { useWallet } from '@solana/wallet-adapter-react'
import { useCallback, useState } from 'react'

const NAV_ITEMS = [
  {
    to: '/app/rounds',
    label: 'Rounds',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
  },
  {
    to: '/app/markets',
    label: 'Markets',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
  },
  {
    to: '/app/bets',
    label: 'Bets',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
  },
  {
    to: '/app/history',
    label: 'History',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  },
  {
    to: '/app/leaderboard',
    label: 'Leaderboard',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 16v6m-4-10v10m-4-4v4"/><path d="M3 3h18v18H3z"/></svg>
  },
  {
    to: '/app/community',
    label: 'Community',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  },
]

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

export function DashboardLayout() {
  const { user, logout } = useAuth()
  const wallet = useWallet()
  const navigate = useNavigate()
  const [showAccount, setShowAccount] = useState(true)

  const handleLogout = useCallback(async () => {
    await wallet.disconnect()
    logout()
    navigate('/')
  }, [logout, navigate, wallet])

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <a href="/" className="brand dashboard-sidebar-brand" aria-label="Tokku dashboard">
          <img src="/tokku-logo.png" alt="" className="brand-mark" aria-hidden />
          <span>tokku</span>
        </a>
        <nav className="dashboard-sidebar-nav" aria-label="Dashboard">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                ['dashboard-nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
            >
              <span className="dashboard-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="dashboard-sidebar-footer">
          <button
            className="dashboard-settings-btn"
            onClick={() => setShowAccount(!showAccount)}
          >
            <span className="dashboard-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </span>
            <span>Account</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>{showAccount ? '▲' : '▼'}</span>
          </button>
          {showAccount && (
            <div className="dashboard-settings-drawer">
              <NavLink to="/app/profile" className="dashboard-settings-item">
                <span className="dashboard-nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                <span>Profile</span>
              </NavLink>
              <NavLink to="/app/settings" className="dashboard-settings-item">
                <span className="dashboard-nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 1v6m0 6v6M6 12H1m17 0h5"/>
                    <path d="m19.07 4.93-4.24 4.24m0 5.66 4.24 4.24M4.93 4.93l4.24 4.24m0 5.66-4.24 4.24"/>
                  </svg>
                </span>
                <span>Settings</span>
              </NavLink>
              <button className="dashboard-settings-item" onClick={handleLogout}>
                <span className="dashboard-nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                </span>
                <span>Disconnect Wallet</span>
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className="dashboard-body">
        <header className="dashboard-topbar">
          <div className="dashboard-topbar-actions">
            {user ? <span className="dashboard-topbar-identity">{shortAddress(user.walletAddress)}</span> : null}
            <Button variant="ghost" onClick={handleLogout} aria-label="Disconnect wallet">
              Disconnect
            </Button>
          </div>
        </header>
        <main className="dashboard-main">
          <div className="container dashboard-main-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
