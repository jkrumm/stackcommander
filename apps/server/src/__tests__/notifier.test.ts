import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobResult } from 'rollhook'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test'

// Mutable config object — tests mutate .notifications and env vars per-test
const mockConfig: {
  apps: Array<{ name: string, clone_path: string }>
  notifications?: { webhook?: string }
} = {
  apps: [{ name: 'test-app', clone_path: '/tmp/test' }],
}

// Register mock before notifier is imported (mock.module must precede import)
mock.module('@/config/loader', () => ({
  loadConfig: () => mockConfig,
  saveConfig: () => {}, // not used by notifier, but required for module interface
}))

let notify: (job: JobResult, logPath: string) => Promise<void>

const TMP_DIR = mkdtempSync(join(tmpdir(), 'rollhook-notifier-'))
const LOG_PATH = join(TMP_DIR, 'notify.log')

const JOB_SUCCESS: JobResult = {
  id: 'job-1',
  app: 'test-app',
  image_tag: 'v1',
  status: 'success',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:01:00.000Z',
}

const JOB_FAILED: JobResult = {
  ...JOB_SUCCESS,
  status: 'failed',
  error: 'docker pull failed (exit 1): image not found',
}

beforeAll(async () => {
  // Dynamic import ensures mock.module is registered first
  const mod = await import('../jobs/notifier')
  notify = mod.notify
})

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true })
})

afterEach(() => {
  mockConfig.notifications = undefined
  delete process.env.PUSHOVER_USER_KEY
  delete process.env.PUSHOVER_APP_TOKEN
  writeFileSync(LOG_PATH, '')
})

describe('notify', () => {
  it('does nothing when no notifications are configured', async () => {
    const spy = spyOn(globalThis, 'fetch')
    await notify(JOB_SUCCESS, LOG_PATH)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('skips Pushover when only one credential env var is set', async () => {
    process.env.PUSHOVER_USER_KEY = 'key-without-token'
    // PUSHOVER_APP_TOKEN intentionally omitted
    const spy = spyOn(globalThis, 'fetch')
    await notify(JOB_SUCCESS, LOG_PATH)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('sends Pushover on success with correct title and payload', async () => {
    process.env.PUSHOVER_USER_KEY = 'test-user-key'
    process.env.PUSHOVER_APP_TOKEN = 'test-app-token'
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    await notify(JOB_SUCCESS, LOG_PATH)
    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0]!
    expect(url).toBe('https://api.pushover.net/1/messages.json')
    const body = JSON.parse(init?.body as string)
    expect(body.title).toBe('✅ Deployed test-app')
    expect(body.token).toBe('test-app-token')
    expect(body.user).toBe('test-user-key')
    spy.mockRestore()
  })

  it('sends Pushover on failure with error reflected in message', async () => {
    process.env.PUSHOVER_USER_KEY = 'test-user-key'
    process.env.PUSHOVER_APP_TOKEN = 'test-app-token'
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    await notify(JOB_FAILED, LOG_PATH)
    const [, init] = spy.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.title).toBe('❌ Deployment failed: test-app')
    expect(body.message).toContain('image not found')
    spy.mockRestore()
  })

  it('sends webhook POST with job payload when configured', async () => {
    mockConfig.notifications = { webhook: 'http://test.localhost/hook' }
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    await notify(JOB_SUCCESS, LOG_PATH)
    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0]!
    expect(url).toBe('http://test.localhost/hook')
    expect(JSON.parse(init?.body as string)).toMatchObject({ id: 'job-1', status: 'success' })
    spy.mockRestore()
  })

  it('sends both Pushover and webhook when both are configured', async () => {
    process.env.PUSHOVER_USER_KEY = 'test-user-key'
    process.env.PUSHOVER_APP_TOKEN = 'test-app-token'
    mockConfig.notifications = { webhook: 'http://test.localhost/hook' }
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    await notify(JOB_SUCCESS, LOG_PATH)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('logs Pushover error and does not throw on non-ok response', async () => {
    process.env.PUSHOVER_USER_KEY = 'test-user-key'
    process.env.PUSHOVER_APP_TOKEN = 'test-app-token'
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"errors":["invalid token"]}', { status: 400 }),
    )
    await expect(notify(JOB_SUCCESS, LOG_PATH)).resolves.toBeUndefined()
    const log = await Bun.file(LOG_PATH).text()
    expect(log).toContain('[notifier] Pushover failed: 400')
    spy.mockRestore()
  })

  it('logs webhook error and does not throw on non-ok response', async () => {
    mockConfig.notifications = { webhook: 'http://test.localhost/hook' }
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    )
    await expect(notify(JOB_SUCCESS, LOG_PATH)).resolves.toBeUndefined()
    const log = await Bun.file(LOG_PATH).text()
    expect(log).toContain('[notifier] Webhook failed: 500')
    spy.mockRestore()
  })
})
