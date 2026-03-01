import type { JobResult } from 'rollhook'
import { execFileSync } from 'node:child_process'

export const BASE_URL = 'http://localhost:7700'
export const TRAEFIK_URL = 'http://localhost:9080'
export const REGISTRY_HOST = 'localhost:5001'
// App name as derived by the server from image tag: image.split('/').pop().split(':')[0]
export const APP_NAME = 'rollhook-e2e-hello'
// Docker Compose names containers as <project>-<service>-<index>, e.g. bun-hello-world-hello-world-1.
export const CONTAINER_NAME_FILTER = 'bun-hello-world-hello-world'

// Count running containers whose name starts with the given prefix.
export function getContainerCount(nameFilter: string = CONTAINER_NAME_FILTER): number {
  try {
    const output = execFileSync(
      'docker',
      ['ps', '--filter', `name=${nameFilter}`, '--format', '{{.Names}}'],
      { encoding: 'utf-8' },
    ).trim()
    return output ? output.split('\n').filter(Boolean).length : 0
  }
  catch {
    return 0
  }
}

export const ADMIN_TOKEN = 'e2e-admin-token'
export const WEBHOOK_TOKEN = 'e2e-webhook-token'

export function adminHeaders(): HeadersInit {
  return { 'Authorization': `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' }
}

export function webhookHeaders(): HeadersInit {
  return { 'Authorization': `Bearer ${WEBHOOK_TOKEN}`, 'Content-Type': 'application/json' }
}

export type { JobResult }

// Poll /jobs/:id every second until status is success or failed.
// Timeout accounts for queue depth: each rollout takes ~16s, up to 4 queued = ~64s worst case.
export async function pollJobUntilDone(jobId: string, timeoutMs = 90_000): Promise<JobResult> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`, { headers: adminHeaders() })
    const job = await res.json() as JobResult
    if (job.status === 'success' || job.status === 'failed')
      return job
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`)
}

// Same as pollJobUntilDone but uses the webhook token — mirrors the real CI journey
// where rollhook-action only has a webhook token, not an admin token.
export async function webhookPollJobUntilDone(jobId: string, timeoutMs = 90_000): Promise<JobResult> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`, { headers: webhookHeaders() })
    const job = await res.json() as JobResult
    if (job.status === 'success' || job.status === 'failed')
      return job
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`)
}
