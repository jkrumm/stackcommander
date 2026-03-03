import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL, pollJobUntilDone, REGISTRY_HOST, ROLLHOOK_SECRET } from '../setup/fixtures.ts'

const MANIFEST_ACCEPT = 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'

function registryHeaders(): HeadersInit {
  return { Authorization: `Bearer ${ROLLHOOK_SECRET}` }
}

describe('registry proxy — auth', () => {
  it('/v2/ without auth returns 401 with WWW-Authenticate header', async () => {
    const res = await fetch(`${BASE_URL}/v2/`)
    expect(res.status).toBe(401)
    const wwwAuth = res.headers.get('WWW-Authenticate')
    expect(wwwAuth).toBeTruthy()
    expect(wwwAuth).toContain('Basic')
  })

  it('/v2/ with valid ROLLHOOK_SECRET as Bearer returns 200', async () => {
    const res = await fetch(`${BASE_URL}/v2/`, {
      headers: { Authorization: `Bearer ${ROLLHOOK_SECRET}` },
    })
    expect(res.status).toBe(200)
  })

  it('/v2/ with wrong secret returns 401', async () => {
    const res = await fetch(`${BASE_URL}/v2/`, {
      headers: { Authorization: 'Bearer definitely-wrong-secret' },
    })
    expect(res.status).toBe(401)
  })

  it('/v2/_catalog without auth returns 401', async () => {
    const res = await fetch(`${BASE_URL}/v2/_catalog`)
    expect(res.status).toBe(401)
  })
})

describe('registry proxy — catalog and tags', () => {
  it('/v2/_catalog lists pushed images', async () => {
    const res = await fetch(`${BASE_URL}/v2/_catalog`, { headers: registryHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json() as { repositories: string[] }
    expect(Array.isArray(body.repositories)).toBe(true)
    expect(body.repositories).toContain('rollhook-e2e-hello')
  })

  it('/v2/rollhook-e2e-hello/tags/list returns all pushed tags', async () => {
    const res = await fetch(`${BASE_URL}/v2/rollhook-e2e-hello/tags/list`, { headers: registryHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string, tags: string[] }
    expect(body.name).toBe('rollhook-e2e-hello')
    expect(body.tags).toContain('v1')
    expect(body.tags).toContain('v2')
    expect(body.tags).toContain('v-unhealthy')
  })

  it('tags/list for nonexistent image returns 404', async () => {
    const res = await fetch(`${BASE_URL}/v2/rollhook-nonexistent-image/tags/list`, { headers: registryHeaders() })
    expect(res.status).toBe(404)
  })
})

describe('registry proxy — manifests', () => {
  it('manifest for existing tag returns 200 with manifest content', async () => {
    const res = await fetch(`${BASE_URL}/v2/rollhook-e2e-hello/manifests/v1`, {
      headers: { ...registryHeaders(), Accept: MANIFEST_ACCEPT },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    // OCI or Docker v2 manifest must have schemaVersion
    expect(typeof body.schemaVersion).toBe('number')
  })

  it('manifest for nonexistent tag returns 404', async () => {
    const res = await fetch(`${BASE_URL}/v2/rollhook-e2e-hello/manifests/v99`, {
      headers: { ...registryHeaders(), Accept: MANIFEST_ACCEPT },
    })
    expect(res.status).toBe(404)
  })
})

describe('registry proxy — push and deploy round-trip', () => {
  it('push new tag via proxy then deploy succeeds', async () => {
    const TAG = `${REGISTRY_HOST}/rollhook-e2e-hello:v3`

    // Tag from the already-built v1 image and push via RollHook's registry proxy
    execFileSync('docker', ['tag', 'rollhook-e2e-hello:v1', TAG])
    execFileSync('docker', ['push', TAG], { stdio: 'inherit' })

    // Verify the tag now appears in the registry
    const tagsRes = await fetch(`${BASE_URL}/v2/rollhook-e2e-hello/tags/list`, { headers: registryHeaders() })
    const { tags } = await tagsRes.json() as { tags: string[] }
    expect(tags).toContain('v3')

    // Full deploy round-trip: RollHook pulls v3 from its embedded Zot and rolls out
    const deployRes = await fetch(`${BASE_URL}/deploy`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ image_tag: TAG }),
    })
    expect(deployRes.status).toBe(200)
    const { job_id } = await deployRes.json() as { job_id: string }
    const job = await pollJobUntilDone(job_id, 90_000)
    expect(job.status).toBe('success')
  }, 120_000)
})
