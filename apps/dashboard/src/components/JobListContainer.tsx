import type { JobResult } from '@rollhook/ui'
import { JobList } from '@rollhook/ui'
import { LogContainer } from './LogContainer'

interface JobListContainerProps {
  jobs: JobResult[]
  expandedId: string | null
  onExpand: (id: string | null) => void
}

export function JobListContainer({ jobs, expandedId, onExpand }: JobListContainerProps) {
  return (
    <JobList
      jobs={jobs}
      expandedId={expandedId}
      onExpand={onExpand}
      renderExpanded={job => <LogContainer jobId={job.id} status={job.status} />}
    />
  )
}
