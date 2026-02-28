import type { JobResult } from '../setup/fixtures.ts'
import { beforeAll, describe, expect, it } from 'vitest'
import { adminHeaders, APP_NAME, BASE_URL, getContainerCount, pollJobUntilDone, REGISTRY_HOST, TRAEFIK_URL, webhookHeaders } from '../setup/fixtures.ts'

const IMAGE_V1 = `${REGISTRY_HOST}/rollhook-e2e-hello:v1`
const NONEXISTENT_IMAGE = `${REGISTRY_HOST}/rollhook-e2e-hello:no-such-tag`

// Single deploy shared across tests that validate the success lifecycle.
// Additional per-test deploys use NONEXISTENT_IMAGE to fail fast at pull.
let jobId: string
let completedJob: JobResult

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/deploy`, {
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
    expect(completedJob.app).toBe(APP_NAME)
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
    expect(detail.app).toBe(APP_NAME)
  })

  it('successful deploy job has compose_path and service populated', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`, { headers: adminHeaders() })
    const job = await res.json() as Record<string, unknown>
    expect(typeof job.compose_path).toBe('string')
    expect((job.compose_path as string).endsWith('compose.yml')).toBe(true)
    expect(job.service).toBe('hello-world')
  })

  it('successful deploy response does not include error field', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`, { headers: adminHeaders() })
    const detail = await res.json() as Record<string, unknown>
    // error should be null or absent, not a string
    expect(detail.error == null || detail.error === '').toBe(true)
  })

  it('job is visible in app-filtered list', async () => {
    const res = await fetch(`${BASE_URL}/jobs?app=${APP_NAME}`, { headers: adminHeaders() })
    const jobs = await res.json() as Array<{ id: string }>
    expect(jobs.some(j => j.id === jobId)).toBe(true)
  })

  it('job is visible in status-filtered list', async () => {
    const res = await fetch(`${BASE_URL}/jobs?status=success`, { headers: adminHeaders() })
    const jobs = await res.json() as Array<{ id: string }>
    expect(jobs.some(j => j.id === jobId)).toBe(true)
  })

  it('deploy with image matching no running container returns 500', async () => {
    // Use an image name with no running containers — discover step fails fast
    const res = await fetch(`${BASE_URL}/deploy`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ image_tag: `${REGISTRY_HOST}/nonexistent-image:v1` }),
    })
    expect(res.status).toBe(500)
    const body = await res.json() as { job_id: string, status: string, error: string }
    expect(body.status).toBe('failed')
    expect(body.error).toContain('No running container found matching image')

    // compose_path and service must be null — discovery never completed
    const jobRes = await fetch(`${BASE_URL}/jobs/${body.job_id}`, { headers: adminHeaders() })
    const job = await jobRes.json() as Record<string, unknown>
    expect(job.compose_path == null).toBe(true)
    expect(job.service == null).toBe(true)
  })

  it('missing image_tag body returns 422 validation error', async () => {
    const res = await fetch(`${BASE_URL}/deploy`, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
  })

  it('?async=true returns queued status immediately without blocking', async () => {
    // Use a nonexistent tag so the job fails fast at pull (~3s) rather than ~16s rollout
    const res = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({ image_tag: NONEXISTENT_IMAGE }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { job_id: string, app: string, status: string }
    // Async mode returns 'queued' — the job hasn't completed yet
    expect(body.status).toBe('queued')
    expect(body.app).toBe(APP_NAME)
    expect(body.job_id).toBeTruthy()

    // Job must eventually reach a terminal state
    const completed = await pollJobUntilDone(body.job_id, 30_000)
    expect(['success', 'failed']).toContain(completed.status)
  })

  it('deployed version is actually served by the app after success', async () => {
    const res = await fetch(`${TRAEFIK_URL}/version`)
    expect(res.status).toBe(200)
    const body = await res.json() as { version: string }
    expect(body.version).toBe('v1')
  })

  it('exactly one container is running after successful deploy', () => {
    // Rolling update must not leave extra containers behind; never too few either
    expect(getContainerCount()).toBe(1)
  })
})
