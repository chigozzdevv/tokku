import { api } from '@/lib/api'

export type RoundStatus = 'QUEUED' | 'PREDICTING' | 'LOCKED' | 'REVEALED' | 'SETTLED' | 'FAILED'

export type Round = {
  id: string
  marketId: string
  roundNumber: number
  status: RoundStatus
  openedAt?: string
  lockedAt?: string
  revealedAt?: string
  settledAt?: string
  queuedAt?: string
  releasedAt?: string
  scheduledReleaseAt?: string
  releaseGroupId?: string
  solanaAddress?: string
  delegateTxHash?: string
  undelegateTxHash?: string
  outcome?: any
  market: {
    id: string
    name: string
    type: string
    config?: any
  }
  bets?: Array<{
    id: string
    stake: string
    selection: any
    status: string
    createdAt: string
  }>
  _count?: {
    bets: number
  }
}

export type ApiResponse<T> = {
  success: boolean
  message?: string
  data: T
}

export const roundsService = {
  async getActiveRounds(marketId?: string): Promise<Round[]> {
    const query = marketId ? `?marketId=${marketId}` : ''
    const response = await api.get<ApiResponse<Round[]>>(`/rounds${query}`)
    return response.data
  },

  async getRound(roundId: string): Promise<Round> {
    const response = await api.get<ApiResponse<Round>>(`/rounds/${roundId}`)
    return response.data
  },

  async openRound(marketId: string): Promise<Round> {
    const response = await api.post<ApiResponse<Round>>('/rounds/open', {
      marketId,
    })
    return response.data
  },

  async lockRound(roundId: string): Promise<{ txHash: string }> {
    const response = await api.post<ApiResponse<{ txHash: string }>>(
      '/rounds/lock',
      { roundId }
    )
    return response.data
  },

  async undelegateRound(roundId: string): Promise<{ txHash: string }> {
    const response = await api.post<ApiResponse<{ txHash: string }>>(
      `/rounds/${roundId}/undelegate`
    )
    return response.data
  },
}
