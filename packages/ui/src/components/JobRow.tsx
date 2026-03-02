import type { JobResult } from '../types'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils'
import { StatusBadge } from './StatusBadge'

const STATUS_BORDER: Record<string, string> = {
  queued: 'border-l-status-queued',
  running: 'border-l-status-running',
  success: 'border-l-status-success',
  failed: 'border-l-status-failed',
}

function formatDuration(createdAt: string, updatedAt: string): string {
  const ms = new Date(updatedAt).getTime() - new Date(createdAt).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60)
    return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function formatDateTime(createdAt: string): string {
  const d = new Date(createdAt)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${min}`
}

function extractVersion(imageTag: string): string {
  const colonIdx = imageTag.lastIndexOf(':')
  return colonIdx >= 0 ? imageTag.slice(colonIdx + 1) : imageTag
}

interface JobRowProps {
  job: JobResult
  expanded: boolean
  onToggle: () => void
}

export function JobRow({ job, expanded, onToggle }: JobRowProps) {
  const showDuration = job.status === 'success' || job.status === 'failed'

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        // Flex: hidden items (chevron, badge) consume no gap or space on mobile
        'w-full flex items-center gap-x-1 sm:gap-x-3 px-2 sm:px-3 py-2',
        'text-left hover:bg-accent/50 transition-colors border-l-[5px]',
        STATUS_BORDER[job.status] ?? 'border-l-transparent',
        expanded && 'bg-accent/30',
      )}
    >
      {/* Chevron — desktop only */}
      <span className="hidden sm:flex items-center justify-center w-3.5 shrink-0">
        {expanded
          ? <ChevronDown className="size-3.5 text-muted-foreground" />
          : <ChevronRight className="size-3.5 text-muted-foreground" />}
      </span>

      {/* App name — fills remaining space, truncates */}
      <span className="flex-1 min-w-0 text-sm truncate">{job.app}</span>

      {/* Status badge — desktop only */}
      <StatusBadge status={job.status} className="hidden sm:inline-flex shrink-0" />

      {/* Fixed-width data columns: consistent position across all rows */}
      <span className="font-mono text-xs text-muted-foreground tabular-nums text-right w-[7ch] shrink-0">
        {extractVersion(job.image_tag)}
      </span>
      <span className="font-mono text-xs text-muted-foreground tabular-nums text-right w-[11ch] shrink-0 ml-2 sm:ml-0">
        {formatDateTime(job.created_at)}
      </span>
      <span className="font-mono text-xs text-muted-foreground tabular-nums text-right w-[6ch] shrink-0">
        {showDuration ? formatDuration(job.created_at, job.updated_at) : '—'}
      </span>
    </button>
  )
}
