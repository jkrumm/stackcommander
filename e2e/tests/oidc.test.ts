import { describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL, REGISTRY_HOST } from '../setup/fixtures.ts'

const MOCK_OIDC_URL = 'http://localhost:8080'
const IMAGE_V2 = `${REGISTRY_HOST}/rollhook-e2e-hello:v2`

/**
 * Request a signed JWT from the mock OIDC server.
 */
async function getOIDCToken(opts: {
  repository: string
  ref: string
  aud?: string
  exp_offset?: number
}): Promise<string> {
  const res = await fetch(`${MOCK_OIDC_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!res.ok)
    throw new Error(`Mock OIDC server returned ${res.status}`)
  const { token } = await res.json() as { token: string }
  return token
}

function oidcHeaders(token: string): HeadersInit {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
}

describe('oidc authentication', () => {
  it('valid OIDC token with allowed repo → deploy accepted', async () => {
    const token = await getOIDCToken({
      repository: 'rollhook-e2e/hello',
      ref: 'refs/heads/main',
    })
    const res = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: oidcHeaders(token),
      body: JSON.stringify({ image_tag: IMAGE_V2 }),
    })
    // 200 = deploy accepted (queued). 503 = queue full (also acceptable under load).
    // 4xx would indicate auth/authz failure.
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })

  it('valid OIDC token but repo not in allowed_repos → 403', async () => {
    const token = await getOIDCToken({
      repository: 'attacker/evil-repo',
      ref: 'refs/heads/main',
    })
    const res = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: oidcHeaders(token),
      body: JSON.stringify({ image_tag: IMAGE_V2 }),
    })
    expect(res.status).toBe(403)
  })

  it('oidc token with PR ref → 403 (hard deny)', async () => {
    const token = await getOIDCToken({
      repository: 'rollhook-e2e/hello',
      ref: 'refs/pull/42/merge',
    })
    const res = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: oidcHeaders(token),
      body: JSON.stringify({ image_tag: IMAGE_V2 }),
    })
    expect(res.status).toBe(403)
  })

  it('oidc token with feature branch ref → 403 (default fail-secure)', async () => {
    const token = await getOIDCToken({
      repository: 'rollhook-e2e/hello',
      ref: 'refs/heads/feature/my-feature',
    })
    const res = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: oidcHeaders(token),
      body: JSON.stringify({ image_tag: IMAGE_V2 }),
    })
    expect(res.status).toBe(403)
  })

  it('oidc token with refs/heads/master → deploy accepted', async () => {
    const token = await getOIDCToken({
      repository: 'rollhook-e2e/hello',
      ref: 'refs/heads/master',
    })
    const res = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: oidcHeaders(token),
      body: JSON.stringify({ image_tag: IMAGE_V2 }),
    })
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })

  it('expired OIDC token → 403', async () => {
    const token = await getOIDCToken({
      repository: 'rollhook-e2e/hello',
      ref: 'refs/heads/main',
      exp_offset: -1, // already expired
    })
    const res = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: oidcHeaders(token),
      body: JSON.stringify({ image_tag: IMAGE_V2 }),
    })
    expect(res.status).toBe(403)
  })

  it('static ROLLHOOK_SECRET still works on /deploy → deploy accepted', async () => {
    const res = await fetch(`${BASE_URL}/deploy?async=true`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ image_tag: `${REGISTRY_HOST}/rollhook-e2e-hello:nonexistent` }),
    })
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })

  it('oidc token cannot access admin /jobs endpoint → 403', async () => {
    const token = await getOIDCToken({
      repository: 'rollhook-e2e/hello',
      ref: 'refs/heads/main',
    })
    const res = await fetch(`${BASE_URL}/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // OIDC JWTs are accepted by HumaAuth but they don't match the static secret.
    // Since /jobs has Security requirement, static-secret check applies → 403.
    expect(res.status).toBe(403)
  })
})
