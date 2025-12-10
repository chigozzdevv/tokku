import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { LandingPage } from './pages/landing/landing-page'
import {
  DashboardLayout,
  RoundsPage,
  MarketsPage,
  MarketDetailPage,
  BetsPage,
  HistoryPage,
  ProfilePage,
  SettingsPage,
  RoundDetailPage,
  CommunityPage,
  LeaderboardPage,
} from './pages/dashboard'
import { useAuth } from './providers/auth-provider'

export default function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  const { initialized, user, loading } = useAuth()

  if (!initialized && loading) {
    return <LoadingScreen />
  }

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={
            <Page>
              <LandingPage />
            </Page>
          }
        />
        <Route
          path="/app"
          element={
            <ProtectedRoute user={user} initialized={initialized}>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<RoundsPage />} />
          <Route path="rounds" element={<RoundsPage />} />
          <Route path="rounds/:roundId" element={<RoundDetailPage />} />
          <Route path="markets" element={<MarketsPage />} />
          <Route path="markets/:marketId" element={<MarketDetailPage />} />
          <Route path="bets" element={<BetsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to={user ? '/app' : '/'} replace />} />
      </Routes>
    </AnimatePresence>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
    >
      {children}
    </motion.div>
  )
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <span>Loading Tossr…</span>
    </div>
  )
}

function ProtectedRoute({
  user,
  initialized,
  children,
}: {
  user: { id: string; walletAddress: string } | null
  initialized: boolean
  children: React.ReactNode
}) {
  if (!initialized) {
    return <LoadingScreen />
  }
  if (!user) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
