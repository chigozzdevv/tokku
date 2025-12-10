import { api } from '@/lib/api'

export interface RoundAnalytics {
  totalVolume: number
  totalBets: number
  avgBetSize: number
  selectionDistribution: {
    selection: string
    bets: number
    volume: number
    percentage: number
  }[]
  timeline: {
    timestamp: string
    bets: number
    volume: number
  }[]
}

export interface OverviewAnalytics {
  totals: {
    users: number
    bets: number
    roundsSettled: number
    pendingBets: number
  }
  finance: {
    totalStaked: number
    totalPaid: number
    profitLoss: number
    winRate: number
  }
  attestations: {
    total: number
    verified: number
    verificationRate: number
  }
  timings: {
    avgLockToRevealMs: number
    avgRevealToSettleMs: number
  }
}

export interface TimeSeriesData {
  date: string
  bets: number
  volume: number
  payout: number
}

class AnalyticsService {
  async getOverview(): Promise<OverviewAnalytics> {
    const data = await api.get<OverviewAnalytics>('/analytics/overview')
    return data
  }

  async getTimeSeries(days: number = 14, granularity: 'daily' | 'weekly' = 'daily'): Promise<TimeSeriesData[]> {
    const query = new URLSearchParams({ days: String(days), granularity })
    const data = await api.get<TimeSeriesData[]>(`/analytics/timeseries?${query.toString()}`)
    return data
  }

  async getMarketMetrics() {
    const data = await api.get('/analytics/markets')
    return data
  }

  async getUserMetrics() {
    const data = await api.get('/analytics/users')
    return data
  }

  // Calculate round-specific analytics from round data
  calculateRoundAnalytics(round: any): RoundAnalytics {
    const bets = round.bets || []
    const totalBets = bets.length
    const totalVolume = bets.reduce((sum: number, bet: any) => sum + (bet.stake || 0), 0) / 1_000_000_000

    // Group bets by selection
    const selectionMap = new Map<string, { bets: number; volume: number }>()

    bets.forEach((bet: any) => {
      const key = JSON.stringify(bet.selection)
      const existing = selectionMap.get(key) || { bets: 0, volume: 0 }
      existing.bets += 1
      existing.volume += (bet.stake || 0) / 1_000_000_000
      selectionMap.set(key, existing)
    })

    const selectionDistribution = Array.from(selectionMap.entries()).map(([selection, data]) => ({
      selection,
      bets: data.bets,
      volume: data.volume,
      percentage: totalBets > 0 ? (data.bets / totalBets) * 100 : 0
    }))

    // Group bets by time (5-minute intervals)
    const timelineMap = new Map<string, { bets: number; volume: number }>()

    bets.forEach((bet: any) => {
      if (!bet.createdAt) return
      const timestamp = new Date(bet.createdAt)
      timestamp.setMinutes(Math.floor(timestamp.getMinutes() / 5) * 5, 0, 0)
      const key = timestamp.toISOString()

      const existing = timelineMap.get(key) || { bets: 0, volume: 0 }
      existing.bets += 1
      existing.volume += (bet.stake || 0) / 1_000_000_000
      timelineMap.set(key, existing)
    })

    const timeline = Array.from(timelineMap.entries())
      .map(([timestamp, data]) => ({
        timestamp,
        bets: data.bets,
        volume: data.volume
      }))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return {
      totalVolume,
      totalBets,
      avgBetSize: totalBets > 0 ? totalVolume / totalBets : 0,
      selectionDistribution,
      timeline
    }
  }
}

export const analyticsService = new AnalyticsService()
