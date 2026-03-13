import type { ChartDataPoint } from '../types'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'

interface DeployChartProps {
  data: ChartDataPoint[]
  selectedDay?: string
  onDayClick?: (day: string) => void
}

export function DeployChart({ data, selectedDay, onDayClick }: DeployChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-muted-foreground text-xs font-mono">
        no deploy history
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={80}>
      <BarChart
        data={data}
        barSize={8}
        barGap={2}
        margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
        style={onDayClick ? { cursor: 'pointer' } : undefined}
        onClick={onDayClick
          ? (chartData) => {
              const day = chartData?.activeLabel
              if (day != null)
                onDayClick(String(day))
            }
          : undefined}
      >
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'currentColor', opacity: 0.5 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--color-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            fontSize: 11,
            fontFamily: 'monospace',
          }}
          cursor={{ fill: 'var(--color-accent)' }}
        />
        <Bar
          dataKey="success"
          stackId="a"
          fill="var(--color-status-success)"
          radius={[0, 0, 2, 2]}
          name="success"
          opacity={selectedDay ? 0.5 : 1}
        />
        <Bar
          dataKey="failed"
          stackId="a"
          fill="var(--color-status-failed)"
          radius={[2, 2, 0, 0]}
          name="failed"
          opacity={selectedDay ? 0.5 : 1}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
