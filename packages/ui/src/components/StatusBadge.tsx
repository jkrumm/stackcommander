import type { JobStatus } from '../types'
import { cn } from '../lib/utils'

const statusConfig: Record<JobStatus, { label: string, className: string }> = {
  queued: { label: 'queued', className: 'bg-status-queued/15 text-status-queued' },
  running: { label: 'running', className: 'bg-status-running/15 text-status-running animate-pulse' },
  success: { label: 'success', className: 'bg-status-success/15 text-status-success' },
  failed: { label: 'failed', className: 'bg-status-failed/15 text-status-failed' },
}

interface StatusBadgeProps {
  status: JobStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, className: statusClass } = statusConfig[status]
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium', statusClass, className)}>
      {label}
    </span>
  )
}
