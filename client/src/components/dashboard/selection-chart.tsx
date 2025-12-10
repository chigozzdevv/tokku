import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell, LineChart, Line } from 'recharts'

type SelectionData = {
  name: string
  bets: number
  percentage: number
  color: string
}

type SelectionChartProps = {
  data: SelectionData[]
  height?: number
  variant?: 'bar' | 'line'
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip">
        <p className="label">{payload[0].payload.name}</p>
        <p className="value">{payload[0].value} bets ({payload[0].payload.percentage}%)</p>
      </div>
    )
  }
  return null
}

export function SelectionChart({ data, height = 240, variant = 'bar' }: SelectionChartProps) {
  if (variant === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2422" opacity={0.3} />
          <XAxis 
            dataKey="name" 
            tick={{ fill: '#9eaba4', fontSize: 11 }}
            axisLine={{ stroke: '#1e2422' }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis 
            tick={{ fill: '#9eaba4', fontSize: 12 }}
            axisLine={{ stroke: '#1e2422' }}
            label={{ value: 'Bets', angle: -90, position: 'insideLeft', fill: '#9eaba4', fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line type="monotone" dataKey="bets" stroke="#62df98" strokeWidth={2} dot={{ stroke: '#62df98', fill: '#0b0f0e' }} />
        </LineChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2422" opacity={0.3} />
        <XAxis 
          dataKey="name" 
          tick={{ fill: '#9eaba4', fontSize: 11 }}
          axisLine={{ stroke: '#1e2422' }}
          angle={-45}
          textAnchor="end"
          height={60}
        />
        <YAxis 
          tick={{ fill: '#9eaba4', fontSize: 12 }}
          axisLine={{ stroke: '#1e2422' }}
          label={{ value: 'Bets', angle: -90, position: 'insideLeft', fill: '#9eaba4', fontSize: 12 }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="bets" animationDuration={600}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
