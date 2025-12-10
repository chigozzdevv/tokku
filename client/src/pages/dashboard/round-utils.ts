import { type Round } from '@/services/rounds.service'

export type RoundSelectionOption = {
  id: string
  label: string
  odds: number
  coverage?: string
  selection: any
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function toConfigObject(config: unknown): Record<string, any> {
  if (!config) return {}
  if (typeof config === 'string') {
    try {
      return JSON.parse(config)
    } catch {
      return {}
    }
  }
  if (typeof config === 'object') return config as Record<string, any>
  return {}
}

export function humanizeMarketType(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase())
}

export function buildRoundOptions(round: Round): RoundSelectionOption[] {
  if (!round || !(round as any).market) return []
  const config = toConfigObject((round as any).market?.config)
  const houseEdgeBps = clamp(asNumber(config.houseEdgeBps, 0), 0, 10000)
  const edgeFactor = 10000 / (10000 + houseEdgeBps)
  const fromEqualBins = (n: number) => Math.max(1, Math.floor(n * edgeFactor * 100) / 100)
  const fromProbability = (num: number, den: number) => {
    if (!num || !den) return 0
    const val = (den / num) * edgeFactor
    return Math.max(1, Math.floor(val * 100) / 100)
  }

  const options: RoundSelectionOption[] = []

  switch ((round as any).market?.type) {
    case 'PICK_RANGE': {
      const partitions = Math.max(1, Math.min(20, Math.floor(asNumber(config.partitionCount, 4))))
      const baseWidth = Math.floor(100 / partitions)
      let start = 1
      for (let i = 0; i < partitions; i++) {
        const isLast = i === partitions - 1
        const end = isLast ? 100 : Math.min(100, start + baseWidth - 1)
        const span = end - start + 1
        options.push({
          id: `range-${i}`,
          label: `${start} – ${end}`,
          odds: fromProbability(span, 100),
          coverage: `${span}/100`,
          selection: { type: 'range', min: start, max: end },
        })
        start = end + 1
      }
      break
    }
    case 'EVEN_ODD':
      options.push(
        { id: 'even', label: 'Even', odds: fromEqualBins(2), coverage: '50/100', selection: { type: 'parity', value: 'even' } },
        { id: 'odd', label: 'Odd', odds: fromEqualBins(2), coverage: '50/100', selection: { type: 'parity', value: 'odd' } },
      )
      break
    case 'LAST_DIGIT':
      for (let digit = 0; digit < 10; digit++) {
        options.push({
          id: `digit-${digit}`,
          label: `Digit ${digit}`,
          odds: fromEqualBins(10),
          coverage: '10/100',
          selection: { type: 'digit', value: digit },
        })
      }
      break
    case 'MODULO_THREE':
      [0, 1, 2].forEach((mod) => {
        options.push({
          id: `mod-${mod}`,
          label: `Remainder ${mod}`,
          odds: fromEqualBins(3),
          coverage: '≈33/100',
          selection: { type: 'modulo', value: mod },
        })
      })
      break
    case 'PATTERN_OF_DAY': {
      const counts = [168, 10, 29, 52, 73, 437, 231]
      const labels = ['Prime', 'Fibonacci', 'Perfect Square', 'Ends in 7', 'Palindrome', 'Even', 'Odd']
      counts.forEach((count, idx) => {
        options.push({
          id: `pattern-${idx}`,
          label: labels[idx] ?? `Pattern ${idx + 1}`,
          odds: fromProbability(count, 1000),
          coverage: `${count}/1000`,
          selection: { type: 'pattern', patternId: idx },
        })
      })
      break
    }
    case 'SHAPE_COLOR':
      options.push(
        { id: 'color', label: 'Match Color', odds: fromProbability(12, 72), coverage: '12/72', selection: { type: 'shape', shape: 255, color: 0, size: 255 } },
        { id: 'shape-color', label: 'Shape + Color', odds: fromProbability(3, 72), coverage: '3/72', selection: { type: 'shape', shape: 0, color: 0, size: 255 } },
        { id: 'full', label: 'Exact Match', odds: fromProbability(1, 72), coverage: '1/72', selection: { type: 'shape', shape: 0, color: 0, size: 0 } },
      )
      break
    case 'JACKPOT':
      options.push({ id: 'jackpot', label: 'Jackpot Hit', odds: fromEqualBins(100), coverage: '1/100', selection: { type: 'single', value: 0 } })
      break
    case 'ENTROPY_BATTLE':
      ;['TEE', 'Chain', 'Sensor'].forEach((label, idx) => {
        options.push({
          id: `entropy-${idx}`,
          label: `${label} Wins`,
          odds: fromEqualBins(3),
          coverage: '≈33/100',
          selection: { type: 'entropy', source: label.toLowerCase() },
        })
      })
      break
    case 'STREAK_METER':
      ;[3, 5, 7].forEach((target) => {
        options.push({
          id: `streak-${target}`,
          label: `${target}-Win Streak`,
          odds: fromProbability(1, Math.pow(2, target)),
          coverage: `1/${Math.pow(2, target)}`,
          selection: { type: 'streak', target },
        })
      })
      break
    case 'COMMUNITY_SEED':
      ;[0, 1, 2].forEach((tolerance) => {
        const choose = (n: number, k: number) => {
          if (k < 0 || k > n) return 0
          let numer = 1
          let denom = 1
          for (let i = 0; i < k; i++) {
            numer *= n - i
            denom *= i + 1
          }
          return Math.floor(numer / denom)
        }
        let num = 0
        for (let k = 0; k <= tolerance; k++) num += choose(8, k)
        options.push({
          id: `community-${tolerance}`,
          label: tolerance === 0 ? 'Exact Byte' : `Distance ≤ ${tolerance}`,
          odds: fromProbability(num, 256),
          coverage: `${num}/256`,
          selection: { type: 'community', byte: 0, tolerance },
        })
      })
      break
    default:
      options.push({ id: 'default', label: 'Primary Bet', odds: fromEqualBins(2), selection: { type: 'default' } })
      break
  }

  return options
}
