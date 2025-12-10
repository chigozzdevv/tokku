import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts'

type ProbabilityData = {
  time: string
  percentage: number
}

type ProbabilityChartProps = {
  data: ProbabilityData[]
  height?: number
  color?: string
  title?: string
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip">
        <p className="label">{payload[0].payload.time}</p>
        <p className="value">{payload[0].value}%</p>
      </div>
    )
  }
  return null
}

export function ProbabilityChart({ data, height = 280, color = '#62df98', title }: ProbabilityChartProps) {
  const timeRanges = ['1H', '6H', '1D', '1W', '1M', 'ALL']

  return (
    <div className="probability-chart-wrapper">
      {title && (
        <div className="probability-chart-header">
          <h3>{title}</h3>
        </div>
      )}
      <div className="probability-chart-controls">
        {timeRanges.map((range) => (
          <button key={range} className="time-range-btn" data-active={range === 'ALL'}>
            {range}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorProb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={color} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2422" opacity={0.3} vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fill: '#9eaba4', fontSize: 11 }}
            axisLine={{ stroke: '#1e2422' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#9eaba4', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => `${value}%`}
            domain={[0, 100]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="percentage"
            stroke={color}
            strokeWidth={2}
            fill="url(#colorProb)"
            animationDuration={800}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
