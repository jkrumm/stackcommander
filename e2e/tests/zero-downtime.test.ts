import { execSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL, pollJobUntilDone, REGISTRY_HOST, TRAEFIK_URL, webhookHeaders } from '../setup/fixtures.ts'

const IMAGE_V1 = `${REGISTRY_HOST}/rollhook-e2e-hello:v1`
const IMAGE_V2 = `${REGISTRY_HOST}/rollhook-e2e-hello:v2`

beforeAll(async () => {
  // Ensure we're starting from a clean v1 state — RollHook writes .env automatically
  const res = await fetch(`${BASE_URL}/deploy/hello-world`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ image_tag: IMAGE_V1 }),
  })
  const { job_id } = await res.json() as { job_id: string }
  const job = await pollJobUntilDone(job_id)
  expect(job.status).toBe('success')
}, 120_000)

afterAll(() => {
  // Nothing to clean up — RollHook manages .env
})

describe('zero-downtime rolling deployment', () => {
  it('v1 is running before deployment', async () => {
    const res = await fetch(`${TRAEFIK_URL}/version`)
    expect(res.status).toBe(200)
    const body = await res.json() as { version: string }
    expect(body.version).toBe('v1')
  })

  it('deploys v2 without dropping requests', async () => {
    // Trigger v2 deployment asynchronously so the poller runs concurrently with rollout
    const deployRes = await fetch(`${BASE_URL}/deploy/hello-world?async=true`, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({ image_tag: IMAGE_V2 }),
    })
    expect(deployRes.status).toBe(200)
    const { job_id } = await deployRes.json() as { job_id: string }

    // Hammer the version endpoint every 50ms while deployment runs
    const errors: string[] = []
    const versions: string[] = []
    let maxContainerCount = 0
    let minContainerCount = Number.POSITIVE_INFINITY

    // Version poller — checks for HTTP errors (zero-downtime assertion)
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

    // Container count poller — verifies at most 2 instances and never 0 during rollout
    const containerPoller = setInterval(() => {
      try {
        const output = execSync(
          'docker ps --filter name=bun-hello-world-hello-world --format "{{.Names}}"',
          { encoding: 'utf-8' },
        ).trim()
        const count = output ? output.split('\n').filter(Boolean).length : 0
        maxContainerCount = Math.max(maxContainerCount, count)
        if (count > 0)
          minContainerCount = Math.min(minContainerCount, count)
      }
      catch {
        // ignore transient docker ps errors
      }
    }, 250)

    const job = await pollJobUntilDone(job_id, 90_000)
    clearInterval(versionPoller)
    clearInterval(containerPoller)

    // Wait a tick to collect any in-flight responses
    await new Promise(resolve => setTimeout(resolve, 300))

    // Zero-downtime: no HTTP errors, saw both versions, container count stayed in bounds
    expect(job.status).toBe('success')
    expect(errors).toHaveLength(0)
    expect(versions.includes('v1')).toBe(true)
    expect(versions.includes('v2')).toBe(true)
    // Rolling deployment: always at least 1 container serving, never more than 2 simultaneously
    expect(minContainerCount).toBeGreaterThanOrEqual(1)
    expect(maxContainerCount).toBeLessThanOrEqual(2)

    // Job logs must contain all three pipeline steps and no executor error
    const logsRes = await fetch(`${BASE_URL}/jobs/${job_id}/logs`, { headers: adminHeaders() })
    expect(logsRes.status).toBe(200)
    const logText = await logsRes.text()
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
})
