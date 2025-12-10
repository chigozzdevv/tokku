import { api } from '@/lib/api'

type ApiSuccess<T> = {
  success: boolean
  data: T
}

export type MarketSummary = {
  id: string
  name: string
  type: string
  isActive: boolean
  config?: unknown
  _count?: {
    rounds: number
    bets: number
  }
}

export type MarketDetail = MarketSummary & {
  rounds: Array<{
    id: string
    roundNumber: number
    status: string
    openedAt?: string
    lockedAt?: string
    settledAt?: string
    _count?: { bets: number }
  }>
}

export const marketsService = {
  async getAll() {
    const response = await api.get<ApiSuccess<MarketSummary[]>>('/markets')
    return response.data
  },

  async getById(marketId: string) {
    const response = await api.get<ApiSuccess<MarketDetail>>(`/markets/${marketId}`)
    return response.data
  },

  async getHistory(marketId: string, limit = 20) {
    const response = await api.get<ApiSuccess<any>>(`/markets/${marketId}/history?limit=${limit}`)
    return response.data
  },
}
