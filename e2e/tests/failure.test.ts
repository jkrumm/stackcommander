import type { JobResult } from '../setup/fixtures.ts'
import { beforeAll, describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL, getContainerCount, REGISTRY_HOST } from '../setup/fixtures.ts'

// Image tag that does not exist in the local registry → docker pull fails fast (no rollout)
const NONEXISTENT_IMAGE = `${REGISTRY_HOST}/rollhook-e2e-hello:does-not-exist`

let failedJob: JobResult

beforeAll(async () => {
  // Synchronous deploy: endpoint blocks until job completes and returns HTTP 500 on failure.
  // No need to poll afterward — the job is already in terminal state when we get the response.
  const res = await fetch(`${BASE_URL}/deploy`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ image_tag: NONEXISTENT_IMAGE }),
  })
  expect(res.status).toBe(500)
  const { job_id } = await res.json() as { job_id: string }

  // Fetch canonical JobResult from DB (has `id` field, full schema)
  const jobRes = await fetch(`${BASE_URL}/jobs/${job_id}`, { headers: adminHeaders() })
  failedJob = await jobRes.json() as JobResult
})

describe('failed deployment lifecycle', () => {
  it('job reaches failed status when image pull fails', () => {
    expect(failedJob.status).toBe('failed')
  })

  it('failed job has error field populated with docker pull message', () => {
    expect(failedJob.error).toBeTruthy()
    expect(failedJob.error).toContain('Docker pull failed')
  })

  it('job logs contain pull step and executor error but not rollout', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${failedJob.id}/logs`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('[pull]')
    expect(text).toContain('[executor] ERROR:')
    expect(text).not.toContain('[rollout]')
  })

  it('failed job appears in ?status=failed list', async () => {
    const res = await fetch(`${BASE_URL}/jobs?status=failed`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const jobs = await res.json() as Array<{ id: string, status: string }>
    const found = jobs.find(j => j.id === failedJob.id)
    expect(found).toBeDefined()
    expect(found!.status).toBe('failed')
  })

  it('failed deploy sets updated_at later than created_at', () => {
    const created = new Date(failedJob.created_at).getTime()
    const updated = new Date(failedJob.updated_at).getTime()
    expect(updated).toBeGreaterThanOrEqual(created)
  })

  it('job logs contain discover step before pull failure', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${failedJob.id}/logs`, { headers: adminHeaders() })
    const text = await res.text()
    expect(text).toContain('[discover] Discovery complete')
    expect(text).toContain('[pull]')
    expect(text).not.toContain('[rollout]')
  })

  it('container count is unchanged after pull failure — no scale-up artifacts', () => {
    // Pull failure happens before rollout: the scale-up step never runs,
    // so no extra containers should be left behind.
    expect(getContainerCount()).toBe(1)
  })
})
