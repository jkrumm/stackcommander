import { beforeAll, describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL, getContainerCount, pollJobUntilDone, REGISTRY_HOST, TRAEFIK_URL, webhookHeaders } from '../setup/fixtures.ts'

const IMAGE_V1 = `${REGISTRY_HOST}/rollhook-e2e-hello:v1`
const IMAGE_V2 = `${REGISTRY_HOST}/rollhook-e2e-hello:v2`

beforeAll(async () => {
  // Ensure we're starting from a clean v1 state before the zero-downtime tests run.
  // The synchronous deploy blocks until complete, so we know v1 is fully up when tests begin.
  const res = await fetch(`${BASE_URL}/deploy`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ image_tag: IMAGE_V1 }),
  })
  expect(res.status).toBe(200)
  const body = await res.json() as { status: string }
  expect(body.status).toBe('success')
}, 120_000)

describe('zero-downtime rolling deployment', () => {
  it('v1 is running and accessible before deployment', async () => {
    const res = await fetch(`${TRAEFIK_URL}/version`)
    expect(res.status).toBe(200)
    const body = await res.json() as { version: string }
    expect(body.version).toBe('v1')
  })

  it('exactly one container is running before deployment', () => {
    expect(getContainerCount()).toBe(1)
  })

  it('deploys v2 without dropping requests', async () => {
    // Trigger v2 deployment asynchronously so the traffic poller runs concurrently with rollout
    const deployRes = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({ image_tag: IMAGE_V2 }),
    })
    expect(deployRes.status).toBe(200)
    const { job_id } = await deployRes.json() as { job_id: string }

    const errors: string[] = []
    const versions: string[] = []
    const initialContainerCount = getContainerCount()
    let maxContainerCount = initialContainerCount
    let minContainerCount = initialContainerCount

    // Version poller: sends a request every 50ms and records any HTTP errors.
    // Any non-2xx response during rollout means downtime.
    const versionPoller = setInterval(async () => {
      try {
        const res = await fetch(`${TRAEFIK_URL}/version`)
        if (!res.ok) {
          errors.push(`HTTP ${res.status}`)
          return
        }
        const body = await res.json() as { version: string }
        versions.push(body.version)
      }
      catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }, 50)

    // Container count poller: verifies at most 2 instances and never 0 during rollout.
    const containerPoller = setInterval(() => {
      const count = getContainerCount()
      maxContainerCount = Math.max(maxContainerCount, count)
      minContainerCount = Math.min(minContainerCount, count)
    }, 250)

    const job = await pollJobUntilDone(job_id, 90_000)
    clearInterval(containerPoller)

    // Wait for Traefik to discover the new container and update routing.
    // Docker rollout completes when the container is healthy at the Docker level,
    // but Traefik needs an additional healthcheck interval (~1s) to start routing.
    await new Promise(resolve => setTimeout(resolve, 3_000))

    clearInterval(versionPoller)
    // Flush any in-flight responses before asserting
    await new Promise(resolve => setTimeout(resolve, 300))

    expect(job.status).toBe('success')

    // Zero-downtime: no HTTP errors during the entire rollout
    expect(errors).toHaveLength(0)

    // Both versions must have been observed: v1 at start, v2 after switchover
    expect(versions.includes('v1')).toBe(true)
    expect(versions.includes('v2')).toBe(true)

    // Rolling deployment invariant: always ≥1 container serving, never >2 simultaneously
    expect(minContainerCount).toBeGreaterThanOrEqual(1)
    expect(maxContainerCount).toBeLessThanOrEqual(2)

    // Pipeline logs: all four steps must appear, no executor error
    const logsRes = await fetch(`${BASE_URL}/jobs/${job_id}/logs`, { headers: adminHeaders() })
    expect(logsRes.status).toBe(200)
    const logText = await logsRes.text()
    expect(logText).toContain('[discover]')
    expect(logText).toContain('[discover] Discovery complete')
    expect(logText).toContain('[validate]')
    expect(logText).toContain('[pull]')
    expect(logText).toContain('[rollout]')
    expect(logText).not.toContain('[executor] ERROR:')
  })

  it('v2 is serving after deployment', async () => {
    const res = await fetch(`${TRAEFIK_URL}/version`)
    expect(res.status).toBe(200)
    const body = await res.json() as { version: string }
    expect(body.version).toBe('v2')
  })

  it('exactly one container is running after deployment', () => {
    // Rolling update must not leave extra containers behind
    expect(getContainerCount()).toBe(1)
  })
})
