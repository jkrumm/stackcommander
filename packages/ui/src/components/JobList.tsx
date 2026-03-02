import type { ReactNode } from 'react'
import type { JobResult } from '../types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { JobRow } from './JobRow'

interface JobListProps {
  jobs: JobResult[]
  expandedId: string | null
  onExpand: (id: string | null) => void
  renderExpanded?: (job: JobResult) => ReactNode
}

export function JobList({ jobs, expandedId, onExpand, renderExpanded }: JobListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: jobs.length,
    getScrollElement: () => parentRef.current,
    // Collapsed row ~40px; expanded row ~400px (uncapped log drawer, ~20 lines × 18px + row)
    estimateSize: i => (expandedId === jobs[i]?.id ? 400 : 40),
    measureElement: el => el.getBoundingClientRect().height,
    overscan: 5,
  })

  return (
    <div ref={parentRef} className="flex-1 min-h-0 overflow-auto">
      {jobs.length === 0
        ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              no jobs found
            </div>
          )
        : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const job = jobs[virtualItem.index]
                const isExpanded = expandedId === job.id
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                    className="border-b border-border"
                  >
                    <JobRow
                      job={job}
                      expanded={isExpanded}
                      onToggle={() => onExpand(isExpanded ? null : job.id)}
                    />
                    {isExpanded && renderExpanded?.(job)}
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}
