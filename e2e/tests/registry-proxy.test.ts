import { describe, expect, it } from 'vitest'
import { BASE_URL, ROLLHOOK_SECRET } from '../setup/fixtures.ts'

describe('registry proxy', () => {
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
})
