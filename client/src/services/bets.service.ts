import { api } from '@/lib/api'

type ApiSuccess<T> = {
  success: boolean
  data: T
}

export type BetRecord = {
  id: string
  roundId: string
  marketId: string
  selection: any
  stake: number
  odds: number
  status: string
  createdAt: string
  payout?: number | null
  round?: {
    id: string
    roundNumber: number
    status: string
    market: {
      name: string
      type: string
    }
    settledAt?: string
  }
}

type BetTxResponse = {
  transaction: string
  betPda: string
  message: string
  vaultPda?: string
  needsVaultAta?: boolean
  mint?: string
  submitRpcUrl?: string
}

export const betsService = {
  async list(params: { status?: string; marketId?: string; page?: number; limit?: number } = {}) {
    const searchParams = new URLSearchParams()
    if (params.status) searchParams.set('status', params.status)
    if (params.marketId) searchParams.set('marketId', params.marketId)
    if (params.page) searchParams.set('page', String(params.page))
    if (params.limit) searchParams.set('limit', String(params.limit))
    const query = searchParams.toString()
    const response = await api.get<ApiSuccess<{ items: BetRecord[]; total: number }>>(
      `/bets/my-bets${query ? `?${query}` : ''}`
    )
    return response.data
  },

  async stats() {
    const response = await api.get<ApiSuccess<Record<string, any>>>('/bets/stats')
    return response.data
  },

  async createTransaction(params: { roundId: string; selection: any; stake: number }) {
    const response = await api.post<ApiSuccess<BetTxResponse>>(
      '/bets/place',
      params,
      { timeoutMs: 120000 } as any
    )
    return response.data
  },

  async confirmBet(params: {
    roundId: string
    selection: any
    stake: number
    txSignature: string
    betPda: string
  }) {
    const response = await api.post<ApiSuccess<any>>('/bets/confirm', params, { timeoutMs: 120000 } as any)
    return response.data
  },
}
