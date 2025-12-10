import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authService } from '@/services/auth.service'

type AuthUser = {
  id: string
  walletAddress: string
}

type AuthContextValue = {
  user: AuthUser | null
  initialized: boolean
  loading: boolean
  signIn: (params: { message: string; signature: string; publicKey: string }) => Promise<void>
  logout: () => void
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      if (!authService.hasSession()) {
        setInitialized(true)
        return
      }
      setLoading(true)
      try {
        const current = await authService.currentUser()
        if (!cancelled) {
          setUser(current)
        }
      } catch (error) {
        authService.clearSession()
        if (!cancelled) {
          setUser(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setInitialized(true)
        }
      }
    }
    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (params: { message: string; signature: string; publicKey: string }) => {
    setLoading(true)
    try {
      const result = await authService.signIn(params)
      setUser(result.user)
    } finally {
      setLoading(false)
      setInitialized(true)
    }
  }, [])

  const refreshSession = useCallback(async () => {
    setLoading(true)
    try {
      const result = await authService.refresh()
      setUser(result.user)
    } catch (error) {
      authService.clearSession()
      setUser(null)
      throw error
    } finally {
      setLoading(false)
      setInitialized(true)
    }
  }, [])

  const logout = useCallback(() => {
    authService.clearSession()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      initialized,
      loading,
      signIn,
      refreshSession,
      logout,
    }),
    [initialized, loading, logout, refreshSession, signIn, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
