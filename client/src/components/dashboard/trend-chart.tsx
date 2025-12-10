import { LineChart, Line, ResponsiveContainer } from 'recharts'

type TrendChartProps = {
  value: number
  color?: string
  height?: number
}

export function TrendChart({ value, color = '#62df98', height = 32 }: TrendChartProps) {
  const generateTrendData = (score: number) => {
    const points = 12
    const data = []
    const baseValue = Math.max(10, score * 25)
    
    for (let i = 0; i < points; i++) {
      const variance = Math.sin(i * 0.8) * 8 + Math.cos(i * 1.2) * 5
      const trend = (i / points) * score * 10
      data.push({
        value: Math.max(5, baseValue + trend + variance)
      })
    }
    
    return data
  }

  const data = generateTrendData(value)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <Line 
          type="monotone" 
          dataKey="value" 
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
