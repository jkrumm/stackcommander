import type { ChartDataPoint, JobResult } from '@rollhook/ui'
import { DeployChart, Logo } from '@rollhook/ui'
import { useCallback, useEffect, useState } from 'react'
import { fetchJobs } from '../lib/api'
import { useUrlState } from '../lib/useUrlState'
import { FilterBar } from './FilterBar'
import { JobListContainer } from './JobListContainer'

function computeChartData(jobs: JobResult[]): ChartDataPoint[] {
  const map = new Map<string, { success: number, failed: number }>()
  for (const job of jobs) {
    if (job.status !== 'success' && job.status !== 'failed')
      continue
    const day = job.created_at.slice(0, 10)
    const entry = map.get(day) ?? { success: 0, failed: 0 }
    entry[job.status]++
    map.set(day, entry)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([day, counts]) => ({ day: day.slice(5), ...counts }))
}

interface DashboardProps {
  onLogout: () => void
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [jobs, setJobs] = useState<JobResult[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [params, setParams] = useUrlState()

  const load = useCallback(async () => {
    try {
      const data = await fetchJobs({ limit: 200 })
      setJobs(data)
      setLoadError(null)
    }
    catch {
      setLoadError('Failed to load jobs. Check token or server connectivity.')
    }
  }, [])

  // Poll every 5s
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 5000)
    return () => clearInterval(id)
  }, [load])

  // Re-poll immediately when tab becomes visible after being hidden
  useEffect(() => {
    function onVisibility() {
      if (!document.hidden)
        void load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [load])

  const appStatusFiltered = jobs.filter(j =>
    (!params.app || j.app === params.app)
    && (!params.status || j.status === params.status),
  )

  const filtered = appStatusFiltered.filter(j =>
    !params.day || j.created_at.slice(5, 10) === params.day,
  )

  const chartData = computeChartData(appStatusFiltered)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <a
          href="https://rollhook.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-foreground hover:text-foreground/80 transition-colors"
        >
          <Logo size={20} />
          <span className="text-sm font-semibold tracking-tight">RollHook</span>
        </a>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/jkrumm/rollhook"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Docs
          </a>
          <button
            type="button"
            onClick={onLogout}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="px-4 pt-4 pb-2">
        <DeployChart
          data={chartData}
          selectedDay={params.day}
          onDayClick={day => setParams({ day: params.day === day ? undefined : day })}
        />
      </div>

      <div className="flex-1 flex flex-col">
        {loadError && (
          <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20">
            {loadError}
          </div>
        )}
        <FilterBar
          jobs={jobs}
          selectedApp={params.app}
          selectedStatus={params.status}
          onAppChange={app => setParams({ app })}
          onStatusChange={status => setParams({ status })}
        />
        <JobListContainer
          jobs={filtered}
          expandedId={params.job ?? null}
          onExpand={id => setParams({ job: id ?? undefined })}
        />
      </div>
    </div>
  )
}
