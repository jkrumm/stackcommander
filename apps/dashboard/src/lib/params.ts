import type { JobStatus } from '@rollhook/ui'

export interface DashboardParams {
  app?: string
  status?: JobStatus
  job?: string
  day?: string
}

const VALID_STATUSES = new Set<JobStatus>(['queued', 'running', 'success', 'failed'])

export function parseParams(search: string): DashboardParams {
  const sp = new URLSearchParams(search)
  const app = sp.get('app') || undefined
  const rawStatus = sp.get('status')
  const status = rawStatus && VALID_STATUSES.has(rawStatus as JobStatus)
    ? (rawStatus as JobStatus)
    : undefined
  const job = sp.get('job') || undefined
  const day = sp.get('day') || undefined
  return { app, status, job, day }
}

export function buildSearch(params: DashboardParams): string {
  const sp = new URLSearchParams()
  if (params.app)
    sp.set('app', params.app)
  if (params.status)
    sp.set('status', params.status)
  if (params.job)
    sp.set('job', params.job)
  if (params.day)
    sp.set('day', params.day)
  return sp.toString()
}
