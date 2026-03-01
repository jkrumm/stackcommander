import { describe, expect, it } from 'bun:test'
import { app } from '../app'
import { validateRegistryAuth } from '../registry/proxy'

// Relies on preload.ts setting ROLLHOOK_SECRET=test-secret-ok

describe('validateRegistryAuth', () => {
  it('returns false for undefined', () => {
    expect(validateRegistryAuth(undefined)).toBe(false)
  })

  it('returns false for null', () => {
    expect(validateRegistryAuth(null)).toBe(false)
  })

  it('returns true for Bearer with correct secret', () => {
    expect(validateRegistryAuth('Bearer test-secret-ok')).toBe(true)
  })

  it('returns false for Bearer with wrong secret', () => {
    expect(validateRegistryAuth('Bearer wrong-secret')).toBe(false)
  })

  it('returns true for Basic with correct password (any username)', () => {
    const header = `Basic ${btoa('anyuser:test-secret-ok')}`
    expect(validateRegistryAuth(header)).toBe(true)
  })

  it('returns true for Basic with rollhook username and correct password', () => {
    const header = `Basic ${btoa('rollhook:test-secret-ok')}`
    expect(validateRegistryAuth(header)).toBe(true)
  })

  it('returns false for Basic with wrong password', () => {
    const header = `Basic ${btoa('anyuser:wrong-secret')}`
    expect(validateRegistryAuth(header)).toBe(false)
  })

  it('returns false for malformed Basic value', () => {
    expect(validateRegistryAuth('Basic not-base64!!!')).toBe(false)
  })
})

describe('GET /v2/ without auth', () => {
  it('returns 401 with WWW-Authenticate header', async () => {
    const res = await app.handle(new Request('http://localhost/v2/'))
    expect(res.status).toBe(401)
    const wwwAuth = res.headers.get('WWW-Authenticate')
    expect(wwwAuth).toBeTruthy()
    expect(wwwAuth).toContain('Basic')
  })

  it('returns 401 for /v2 (no trailing slash) without auth', async () => {
    const res = await app.handle(new Request('http://localhost/v2'))
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong Bearer token', async () => {
    const res = await app.handle(
      new Request('http://localhost/v2/', {
        headers: { Authorization: 'Bearer wrong-secret' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong Basic credentials', async () => {
    const res = await app.handle(
      new Request('http://localhost/v2/', {
        headers: { Authorization: `Basic ${btoa('user:wrong-secret')}` },
      }),
    )
    expect(res.status).toBe(401)
  })
})
