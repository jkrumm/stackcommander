import type { JobResult, JobStatus } from 'rollhook'
import { db } from '@/db/client'

export function insertJob(job: JobResult): void {
  db.prepare(`
    INSERT INTO jobs (id, app, image_tag, status, created_at, updated_at)
    VALUES ($id, $app, $image_tag, $status, $created_at, $updated_at)
  `).run({
    $id: job.id,
    $app: job.app,
    $image_tag: job.image_tag,
    $status: job.status,
    $created_at: job.created_at,
    $updated_at: job.updated_at,
  })
}

export function getJob(id: string): JobResult | null {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobResult | null
}

export function updateJobStatus(id: string, status: JobStatus, error?: string): void {
  db.prepare(`
    UPDATE jobs SET status = $status, error = $error, updated_at = $updated_at WHERE id = $id
  `).run({
    $id: id,
    $status: status,
    $error: error ?? null,
    $updated_at: new Date().toISOString(),
  })
}

export interface ListJobsOptions {
  app?: string
  status?: JobStatus
  limit?: number
}

export function listJobs({ app, status, limit = 50 }: ListJobsOptions = {}): JobResult[] {
  const conditions: string[] = []
  const params: Record<string, string | number> = {}

  if (app) {
    conditions.push('app = $app')
    params.$app = app
  }
  if (status) {
    conditions.push('status = $status')
    params.$status = status
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  params.$limit = limit

  return db.prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT $limit`).all(params) as JobResult[]
}
