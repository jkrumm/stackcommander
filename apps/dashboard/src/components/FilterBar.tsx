import type { JobResult, JobStatus } from '@rollhook/ui'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'

const STATUSES: Array<{ label: string, selectLabel: string, value: JobStatus | undefined }> = [
  { label: 'All', selectLabel: 'Status', value: undefined },
  { label: 'Queued', selectLabel: 'Queued', value: 'queued' },
  { label: 'Running', selectLabel: 'Running', value: 'running' },
  { label: 'Success', selectLabel: 'Success', value: 'success' },
  { label: 'Failed', selectLabel: 'Failed', value: 'failed' },
]

interface FilterBarProps {
  jobs: JobResult[]
  selectedApp: string | undefined
  selectedStatus: JobStatus | undefined
  onAppChange: (app: string | undefined) => void
  onStatusChange: (status: JobStatus | undefined) => void
}

export function FilterBar({ jobs, selectedApp, selectedStatus, onAppChange, onStatusChange }: FilterBarProps) {
  const apps = Array.from(new Set(jobs.map(j => j.app))).sort()

  const counts = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border sm:gap-4">
      <SlidersHorizontal className="size-3.5 text-muted-foreground shrink-0 sm:hidden" />
      <div className="relative flex-1 sm:flex-none">
        <select
          aria-label="Filter by app"
          value={selectedApp ?? ''}
          onChange={e => onAppChange(e.target.value || undefined)}
          className="w-full appearance-none bg-background border border-border rounded-md pl-3 pr-8 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer"
        >
          <option value="">Apps</option>
          {apps.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
      </div>

      {/* xs/sm: status select */}
      <div className="relative flex-1 sm:hidden">
        <select
          aria-label="Filter by status"
          value={selectedStatus ?? ''}
          onChange={e => onStatusChange((e.target.value as JobStatus) || undefined)}
          className="w-full appearance-none bg-background border border-border rounded-md pl-3 pr-8 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring cursor-pointer"
        >
          {STATUSES.map(({ selectLabel, value }) => (
            <option key={selectLabel} value={value ?? ''}>{selectLabel}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
      </div>

      {/* sm+: tab buttons */}
      <div className="hidden sm:flex items-center">
        {STATUSES.map(({ label, value }) => {
          const count = value ? (counts[value] ?? 0) : jobs.length
          const isActive = selectedStatus === value
          return (
            <button
              key={label}
              type="button"
              onClick={() => onStatusChange(value)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 transition-colors ${
                isActive
                  ? 'border-foreground text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`text-[10px] rounded px-1 py-0.5 leading-none tabular-nums ${
                  isActive ? 'bg-foreground/10 text-foreground' : 'bg-muted text-muted-foreground'
                }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
