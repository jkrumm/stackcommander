import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { ServerConfigSchema } from 'rollhook'

// Tests Value.Check() directly to avoid the module-level cache in loadConfig()

describe('ServerConfigSchema', () => {
  it('accepts a valid config', () => {
    const valid = {
      apps: [{ name: 'my-api', compose_path: '/srv/stacks/my-api/compose.yml', steps: [{ service: 'backend' }] }],
    }
    expect(Value.Check(ServerConfigSchema, valid)).toBe(true)
  })

  it('rejects missing apps array', () => {
    expect(Value.Check(ServerConfigSchema, {})).toBe(false)
  })

  it('rejects missing steps in app entry', () => {
    const invalid = { apps: [{ name: 'my-api', compose_path: '/srv/stacks/my-api/compose.yml' }] }
    expect(Value.Check(ServerConfigSchema, invalid)).toBe(false)
  })

  it('rejects missing name in app entry', () => {
    const invalid = { apps: [{ compose_path: '/srv/stacks/my-api/compose.yml', steps: [{ service: 'backend' }] }] }
    expect(Value.Check(ServerConfigSchema, invalid)).toBe(false)
  })

  it('accepts optional notifications field', () => {
    const valid = {
      apps: [{ name: 'my-api', compose_path: '/srv/stacks/my-api/compose.yml', steps: [{ service: 'backend' }] }],
      notifications: { webhook: 'https://hooks.example.com/notify' },
    }
    expect(Value.Check(ServerConfigSchema, valid)).toBe(true)
  })

  it('reports validation errors for invalid config', () => {
    const invalid = { apps: [{ name: 42, compose_path: '/srv', steps: [] }] }
    const errors = [...Value.Errors(ServerConfigSchema, invalid)]
    expect(errors.length).toBeGreaterThan(0)
  })
})
