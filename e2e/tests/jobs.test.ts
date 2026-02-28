import { beforeAll, describe, expect, it } from 'vitest'
import { adminHeaders, APP_NAME, BASE_URL, REGISTRY_HOST, webhookHeaders, webhookPollJobUntilDone } from '../setup/fixtures.ts'

const IMAGE_V1 = `${REGISTRY_HOST}/rollhook-e2e-hello:v1`
const NONEXISTENT_IMAGE = `${REGISTRY_HOST}/rollhook-e2e-hello:no-such-tag`

// One successful deploy (full pipeline → all log prefixes) and one failing deploy
// (pull fails fast → no rollout log) — gives us fixtures for all jobs API assertions.
let completedJobId: string
let failedJobId: string

beforeAll(async () => {
  // Successful deploy: IMAGE_V1 runs the full pipeline, producing [validate] [pull] [rollout] logs
  const successRes = await fetch(`${BASE_URL}/deploy`, {
    method: 'POST',
    headers: webhookHeaders(),
    body: JSON.stringify({ image_tag: IMAGE_V1 }),
  })
  expect(successRes.status).toBe(200)
  const successBody = await successRes.json() as { job_id: string }
  completedJobId = successBody.job_id

  // Failed deploy: nonexistent image fails at pull in ~3s, no rollout runs
  const failRes = await fetch(`${BASE_URL}/deploy`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ image_tag: NONEXISTENT_IMAGE }),
  })
  expect(failRes.status).toBe(500)
  const failBody = await failRes.json() as { job_id: string }
  failedJobId = failBody.job_id
}, 120_000)

describe('jobs API', () => {
  it('unknown job id → 404', async () => {
    const res = await fetch(`${BASE_URL}/jobs/00000000-0000-0000-0000-000000000000`, {
      headers: adminHeaders(),
    })
    expect(res.status).toBe(404)
  })

  it('/jobs/:id returns job with correct fields', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${completedJobId}`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const job = await res.json() as Record<string, unknown>
    expect(job.id).toBe(completedJobId)
    expect(job.status).toBe('success')
    expect(job.app).toBe(APP_NAME)
    expect(job.image_tag).toBe(IMAGE_V1)
    expect(job.created_at).toBeTruthy()
    expect(job.updated_at).toBeTruthy()
  })

  it('/jobs/:id/logs returns SSE stream with all pipeline prefixes', async () => {
    const logRes = await fetch(`${BASE_URL}/jobs/${completedJobId}/logs`, { headers: adminHeaders() })
    expect(logRes.status).toBe(200)
    expect(logRes.headers.get('content-type')).toContain('text/event-stream')

    const text = await logRes.text()
    expect(text).toContain('[executor]')
    expect(text).toContain('[discover]')
    expect(text).toContain('[validate]')
    expect(text).toContain('[pull]')
    expect(text).toContain('[rollout]')
  })

  it('failed job logs contain pull error but not rollout', async () => {
    const logRes = await fetch(`${BASE_URL}/jobs/${failedJobId}/logs`, { headers: adminHeaders() })
    expect(logRes.status).toBe(200)

    const text = await logRes.text()
    expect(text).toContain('[pull]')
    expect(text).toContain('[executor] ERROR:')
    expect(text).not.toContain('[rollout]')
  })

  it('/jobs/:id/logs returns 404 for unknown job', async () => {
    const res = await fetch(`${BASE_URL}/jobs/00000000-0000-0000-0000-000000000000/logs`, {
      headers: adminHeaders(),
    })
    expect(res.status).toBe(404)
  })

  it('limit query param is respected', async () => {
    const res = await fetch(`${BASE_URL}/jobs?limit=1`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const jobs = await res.json() as unknown[]
    expect(jobs.length).toBeLessThanOrEqual(1)
  })

  it('?app filter returns only jobs for that app', async () => {
    const res = await fetch(`${BASE_URL}/jobs?app=${APP_NAME}`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const jobs = await res.json() as Array<{ app: string, id: string }>
    expect(jobs.length).toBeGreaterThan(0)
    for (const j of jobs) expect(j.app).toBe(APP_NAME)
    expect(jobs.some(j => j.id === completedJobId)).toBe(true)
  })

  it('?app=nonexistent returns empty array', async () => {
    const res = await fetch(`${BASE_URL}/jobs?app=nonexistent-app`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const jobs = await res.json() as unknown[]
    expect(jobs).toHaveLength(0)
  })

  it('?status=success returns only successful jobs', async () => {
    const res = await fetch(`${BASE_URL}/jobs?status=success`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const jobs = await res.json() as Array<{ id: string, status: string }>
    expect(jobs.length).toBeGreaterThan(0)
    for (const j of jobs) expect(j.status).toBe('success')
    expect(jobs.some(j => j.id === completedJobId)).toBe(true)
  })

  it('?status=failed returns only failed jobs', async () => {
    const res = await fetch(`${BASE_URL}/jobs?status=failed`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const jobs = await res.json() as Array<{ id: string, status: string }>
    expect(jobs.length).toBeGreaterThan(0)
    for (const j of jobs) expect(j.status).toBe('failed')
    expect(jobs.some(j => j.id === failedJobId)).toBe(true)
  })

  it('?app and ?status can be combined', async () => {
    const res = await fetch(`${BASE_URL}/jobs?app=${APP_NAME}&status=success`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const jobs = await res.json() as Array<{ app: string, status: string }>
    jobs.forEach((j) => {
      expect(j.app).toBe(APP_NAME)
      expect(j.status).toBe('success')
    })
  })

  it('webhook token can fetch /jobs/:id and receives correct job data', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${completedJobId}`, { headers: webhookHeaders() })
    expect(res.status).toBe(200)
    const job = await res.json() as Record<string, unknown>
    expect(job.id).toBe(completedJobId)
    expect(job.status).toBe('success')
    expect(job.app).toBe(APP_NAME)
  })

  it('webhook token can stream /jobs/:id/logs', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${completedJobId}/logs`, { headers: webhookHeaders() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('webhook token can poll a job to completion (single-token CI journey)', async () => {
    // Deploy with webhook token and poll with the same token — mirrors rollhook-action behavior
    const deployRes = await fetch(`${BASE_URL}/deploy`, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({ image_tag: IMAGE_V1 }),
    })
    expect(deployRes.status).toBe(200)
    const { job_id } = await deployRes.json() as { job_id: string }

    const job = await webhookPollJobUntilDone(job_id)
    expect(job.status).toBe('success')
    expect(job.id).toBe(job_id)
  }, 90_000)
})
