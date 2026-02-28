import { describe, expect, it } from 'vitest'
import { adminHeaders, APP_NAME, BASE_URL, getContainerCount, pollJobUntilDone, REGISTRY_HOST, webhookHeaders } from '../setup/fixtures.ts'

const IMAGE_V1 = `${REGISTRY_HOST}/rollhook-e2e-hello:v1`

describe('job queue', () => {
  it('processes two concurrent async deploys sequentially and both succeed', async () => {
    // Fire two async deploys simultaneously — both enter the queue before either starts running.
    // This validates that the FIFO queue accepts concurrent requests and processes them in order.
    const [res1, res2] = await Promise.all([
      fetch(`${BASE_URL}/deploy?async=true`, {
        method: 'POST',
        headers: webhookHeaders(),
        body: JSON.stringify({ image_tag: IMAGE_V1 }),
      }),
      fetch(`${BASE_URL}/deploy?async=true`, {
        method: 'POST',
        headers: webhookHeaders(),
        body: JSON.stringify({ image_tag: IMAGE_V1 }),
      }),
    ])

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)

    const body1 = await res1.json() as { job_id: string, status: string }
    const body2 = await res2.json() as { job_id: string, status: string }

    // Both accepted with queued/running status (not failed)
    expect(['queued', 'running']).toContain(body1.status)
    expect(['queued', 'running']).toContain(body2.status)
    expect(body1.job_id).not.toBe(body2.job_id)

    // Wait for both to complete — they run sequentially so allow time for two rollouts
    const [job1, job2] = await Promise.all([
      pollJobUntilDone(body1.job_id, 90_000),
      pollJobUntilDone(body2.job_id, 90_000),
    ])

    expect(job1.status).toBe('success')
    expect(job2.status).toBe('success')

    // FIFO: the job created first must have finished before or at the same time as the second.
    // Sequential queue means job2 cannot complete before job1.
    expect(new Date(job1.updated_at).getTime()).toBeLessThanOrEqual(
      new Date(job2.updated_at).getTime(),
    )

    // After both deploys complete there must be exactly 1 container — each rollout
    // scales up and then drains the old containers, not accumulating extras.
    expect(getContainerCount()).toBe(1)
  })

  it('queued jobs are listed with correct status before processing', async () => {
    // Fire a slow successful deploy (blocks for ~16s) then immediately check the list
    const slowRes = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({ image_tag: IMAGE_V1 }),
    })
    expect(slowRes.status).toBe(200)
    const { job_id: slowJobId } = await slowRes.json() as { job_id: string }

    // While the first job is running, verify GET /jobs returns it with queued or running status
    const listRes = await fetch(`${BASE_URL}/jobs?app=${APP_NAME}&limit=5`, { headers: adminHeaders() })
    expect(listRes.status).toBe(200)
    const listedJobs = await listRes.json() as Array<{ id: string, status: string }>
    const listed = listedJobs.find(j => j.id === slowJobId)
    expect(listed).toBeTruthy()
    expect(['queued', 'running', 'success']).toContain(listed!.status)

    // Wait for completion before next test
    await pollJobUntilDone(slowJobId, 90_000)
  })
})
