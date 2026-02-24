import type { JobResult } from '../setup/fixtures.ts'
import { beforeAll, describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL, pollJobUntilDone, REGISTRY_HOST } from '../setup/fixtures.ts'

// Image tag that does not exist in the local registry → docker pull fails fast (no rollout)
const NONEXISTENT_IMAGE = `${REGISTRY_HOST}/rollhook-e2e-hello:does-not-exist`

let failedJob: JobResult

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/deploy/hello-world`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ image_tag: NONEXISTENT_IMAGE }),
  })
  expect(res.status).toBe(200)
  const { job_id } = await res.json() as { job_id: string }
  // Pull fails in seconds — 60s is conservative to account for any queue depth
  failedJob = await pollJobUntilDone(job_id, 60_000)
})

describe('failed deployment lifecycle', () => {
  it('job reaches failed status when image pull fails', () => {
    expect(failedJob.status).toBe('failed')
  })

  it('failed job has error field populated', () => {
    expect(failedJob.error).toBeTruthy()
    expect(failedJob.error).toContain('docker pull failed')
  })

  it('job logs contain pull step and executor error', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${failedJob.id}/logs`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('[pull]')
    expect(text).toContain('[executor] ERROR:')
  })
})
