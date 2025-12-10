import { api } from '@/lib/api'
import { clearSessionToken, getSessionToken, setSessionToken } from '@/lib/session'

type ApiSuccess<T> = {
  success: boolean
  data: T
  message?: string
}

type AuthPayload = {
  user: {
    id: string
    walletAddress: string
  }
  token: string
}

export const authService = {
  async requestNonce(publicKey: string) {
    const response = await api.post<ApiSuccess<{ nonce: string; message: string }>>(
      '/auth/nonce',
      { publicKey }
    )
    return response.data
  },

  async signIn(params: { message: string; signature: string; publicKey: string }) {
    const response = await api.post<ApiSuccess<AuthPayload>>('/auth/sign-in', params)
    setSessionToken(response.data.token)
    return response.data
  },

  async refresh() {
    const response = await api.post<ApiSuccess<AuthPayload>>('/auth/refresh')
    setSessionToken(response.data.token)
    return response.data
  },

  async currentUser() {
    const response = await api.get<ApiSuccess<{ id: string; walletAddress: string }>>('/auth/me')
    return response.data
  },

  clearSession() {
    clearSessionToken()
  },

  hasSession() {
    return Boolean(getSessionToken())
  },
}
