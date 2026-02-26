import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL } from '../setup/fixtures.ts'

const E2E_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..')

describe('registry API', () => {
  it('lists hello-world with compose_path and steps', async () => {
    const res = await fetch(`${BASE_URL}/registry`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const apps = await res.json() as Array<{ name: string, compose_path: string, steps: Array<{ service: string }> }>
    const helloWorld = apps.find(a => a.name === 'hello-world')
    expect(helloWorld).toBeDefined()
    expect(helloWorld!.compose_path).toContain('bun-hello-world')
    expect(helloWorld!.steps).toHaveLength(1)
    expect(helloWorld!.steps[0]!.service).toBe('hello-world')
  })

  it('includes last_deploy field', async () => {
    const res = await fetch(`${BASE_URL}/registry`, { headers: adminHeaders() })
    const apps = await res.json() as Array<{ name: string, last_deploy: unknown }>
    const helloWorld = apps.find(a => a.name === 'hello-world')
    // May be null (no deploys yet) or a job object if auth tests already deployed
    expect(helloWorld).toBeDefined()
    expect(helloWorld).toHaveProperty('last_deploy')
  })

  it('patching compose_path returns updated value', async () => {
    // Save original path so we can restore after the test
    const listRes = await fetch(`${BASE_URL}/registry`, { headers: adminHeaders() })
    const apps = await listRes.json() as Array<{ name: string, compose_path: string }>
    const originalPath = apps.find(a => a.name === 'hello-world')!.compose_path

    const res = await fetch(`${BASE_URL}/registry/hello-world`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ compose_path: '/tmp/test-path/compose.yml' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string, compose_path: string }
    expect(body.compose_path).toBe('/tmp/test-path/compose.yml')

    // Restore original path to avoid breaking subsequent deploy tests
    await fetch(`${BASE_URL}/registry/hello-world`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ compose_path: originalPath }),
    })
  })

  it('patching compose_path persists to config file', async () => {
    const listRes = await fetch(`${BASE_URL}/registry`, { headers: adminHeaders() })
    const apps = await listRes.json() as Array<{ name: string, compose_path: string }>
    const originalPath = apps.find(a => a.name === 'hello-world')!.compose_path

    await fetch(`${BASE_URL}/registry/hello-world`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ compose_path: '/tmp/persist-test/compose.yml' }),
    })

    const yaml = readFileSync(join(E2E_DIR, 'rollhook.config.yaml'), 'utf-8')
    expect(yaml).toContain('/tmp/persist-test/compose.yml')

    // Restore
    await fetch(`${BASE_URL}/registry/hello-world`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ compose_path: originalPath }),
    })
  })

  it('patching nonexistent app returns 404', async () => {
    const res = await fetch(`${BASE_URL}/registry/nonexistent-app`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ compose_path: '/tmp/test/compose.yml' }),
    })
    expect(res.status).toBe(404)
  })
})
