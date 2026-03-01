import { describe, expect, it } from 'bun:test'
import { generateHtpasswd, generateZotConfig, getZotPassword, ZOT_USER } from '../registry/config'

describe('getZotPassword', () => {
  it('returns ROLLHOOK_SECRET', () => {
    expect(getZotPassword()).toBe('test-secret-ok')
  })
})

describe('generateZotConfig', () => {
  const opts = {
    storageRoot: '/data/registry',
    htpasswdPath: '/data/registry/.htpasswd',
    port: 5000,
  }

  it('returns valid JSON', () => {
    expect(() => JSON.parse(generateZotConfig(opts))).not.toThrow()
  })

  it('binds to loopback only', () => {
    const config = JSON.parse(generateZotConfig(opts))
    expect(config.http.address).toBe('127.0.0.1')
  })

  it('uses the specified port as string', () => {
    const config = JSON.parse(generateZotConfig(opts))
    expect(config.http.port).toBe('5000')
  })

  it('sets the storage root directory', () => {
    const config = JSON.parse(generateZotConfig(opts))
    expect(config.storage.rootDirectory).toBe('/data/registry')
  })

  it('configures htpasswd auth path', () => {
    const config = JSON.parse(generateZotConfig(opts))
    expect(config.http.auth.htpasswd.path).toBe('/data/registry/.htpasswd')
  })

  it('includes distSpecVersion', () => {
    const config = JSON.parse(generateZotConfig(opts))
    expect(config.distSpecVersion).toBe('1.1.1')
  })

  it('enables docker2s2 compat mode', () => {
    const config = JSON.parse(generateZotConfig(opts))
    expect(config.http.compat).toEqual(['docker2s2'])
  })
})

describe('generateHtpasswd', () => {
  it('starts with ZOT_USER', async () => {
    const htpasswd = await generateHtpasswd()
    expect(htpasswd).toStartWith(`${ZOT_USER}:`)
  })

  it('contains a bcrypt hash', async () => {
    const htpasswd = await generateHtpasswd()
    const hash = htpasswd.split(':')[1]!.trim()
    expect(hash).toStartWith('$2b$')
  })

  it('hash verifies against ROLLHOOK_SECRET', async () => {
    const htpasswd = await generateHtpasswd()
    const hash = htpasswd.split(':')[1]!.trim()
    expect(await Bun.password.verify(getZotPassword(), hash)).toBe(true)
  })
})
