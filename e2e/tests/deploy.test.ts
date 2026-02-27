import type { JobResult } from '../setup/fixtures.ts'
import { beforeAll, describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL, pollJobUntilDone, REGISTRY_HOST, webhookHeaders } from '../setup/fixtures.ts'

const IMAGE_V1 = `${REGISTRY_HOST}/rollhook-e2e-hello:v1`
const NONEXISTENT_IMAGE = `${REGISTRY_HOST}/rollhook-e2e-hello:no-such-tag`

// Single deploy shared across tests that validate the success lifecycle.
// Additional per-test deploys use NONEXISTENT_IMAGE to fail fast at pull.
let jobId: string
let completedJob: JobResult

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/deploy/hello-world`, {
    method: 'POST',
    headers: webhookHeaders(),
    body: JSON.stringify({ image_tag: IMAGE_V1 }),
  })
  expect(res.status).toBe(200)
  const body = await res.json() as { job_id: string, app: string, status: string }
  jobId = body.job_id
  completedJob = await pollJobUntilDone(jobId)
})

describe('deploy API', () => {
  it('synchronous deploy blocks until complete and returns success status', () => {
    expect(jobId).toBeTruthy()
    expect(completedJob.status).toBe('success')
    expect(completedJob.app).toBe('hello-world')
    expect(completedJob.image_tag).toBe(IMAGE_V1)
    expect(completedJob.created_at).toBeTruthy()
    expect(completedJob.updated_at).toBeTruthy()
  })

  it('completed job is retrievable via GET /jobs/:id', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const detail = await res.json() as Record<string, unknown>
    expect(detail.id).toBe(jobId)
    expect(detail.status).toBe('success')
    expect(detail.app).toBe('hello-world')
  })

  it('successful deploy response does not include error field', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`, { headers: adminHeaders() })
    const detail = await res.json() as Record<string, unknown>
    // error should be null or absent, not a string
    expect(detail.error == null || detail.error === '').toBe(true)
  })

  it('job is visible in app-filtered list', async () => {
    const res = await fetch(`${BASE_URL}/jobs?app=hello-world`, { headers: adminHeaders() })
    const jobs = await res.json() as Array<{ id: string }>
    expect(jobs.some(j => j.id === jobId)).toBe(true)
  })

  it('job is visible in status-filtered list', async () => {
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

  it('missing image_tag body returns 422 validation error', async () => {
    const res = await fetch(`${BASE_URL}/deploy/hello-world`, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
  })

  it('?async=true returns queued status immediately without blocking', async () => {
    // Use a nonexistent tag so the job fails fast at pull (~3s) rather than ~16s rollout
    const res = await fetch(`${BASE_URL}/deploy/hello-world?async=true`, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({ image_tag: NONEXISTENT_IMAGE }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { job_id: string, app: string, status: string }
    // Async mode returns 'queued' — the job hasn't completed yet
    expect(body.status).toBe('queued')
    expect(body.app).toBe('hello-world')
    expect(body.job_id).toBeTruthy()

    // Job must eventually reach a terminal state
    const completed = await pollJobUntilDone(body.job_id, 30_000)
    expect(['success', 'failed']).toContain(completed.status)
  })
})
