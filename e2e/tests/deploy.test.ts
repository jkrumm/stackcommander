import type { JobResult } from '../setup/fixtures.ts'
import { beforeAll, describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL, pollJobUntilDone, webhookHeaders } from '../setup/fixtures.ts'

const IMAGE_V1 = 'localhost:5001/rollhook-e2e-hello:v1'

// Single deploy shared across all tests — avoids accumulating container instances.
// Each test validates a different aspect of the same completed job.
let jobId: string
let queuedApp: string
let queuedStatus: string
let completedJob: JobResult

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/deploy/hello-world`, {
    method: 'POST',
    headers: webhookHeaders(),
    body: JSON.stringify({ image_tag: IMAGE_V1 }),
  })
  const body = await res.json() as { job_id: string, app: string, status: string }
  jobId = body.job_id
  queuedApp = body.app
  queuedStatus = body.status
  completedJob = await pollJobUntilDone(jobId)
})

describe('deploy API', () => {
  it('deploy endpoint returns queued job', () => {
    expect(jobId).toBeTruthy()
    expect(queuedApp).toBe('hello-world')
    expect(queuedStatus).toBe('queued')
  })

  it('deploy completes with success status', () => {
    expect(completedJob.status).toBe('success')
    expect(completedJob.app).toBe('hello-world')
    expect(completedJob.image_tag).toBe(IMAGE_V1)
    expect(completedJob.created_at).toBeTruthy()
    expect(completedJob.updated_at).toBeTruthy()
  })

  it('completed job has correct fields', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const detail = await res.json() as Record<string, unknown>
    expect(detail.id).toBe(jobId)
    expect(detail.status).toBe('success')
    expect(detail.app).toBe('hello-world')
  })

  it('job is visible in app-filtered job list', async () => {
    const res = await fetch(`${BASE_URL}/jobs?app=hello-world`, { headers: adminHeaders() })
    const jobs = await res.json() as Array<{ id: string }>
    expect(jobs.some(j => j.id === jobId)).toBe(true)
  })

  it('job is visible in status-filtered job list', async () => {
    const res = await fetch(`${BASE_URL}/jobs?status=success`, { headers: adminHeaders() })
    const jobs = await res.json() as Array<{ id: string }>
    expect(jobs.some(j => j.id === jobId)).toBe(true)
  })

  it('deploying unknown app returns 404', async () => {
    const res = await fetch(`${BASE_URL}/deploy/nonexistent-app`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ image_tag: IMAGE_V1 }),
    })
    expect(res.status).toBe(404)
  })
})
