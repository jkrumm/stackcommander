import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import process from 'node:process'
import { parseDockerHost } from '../docker/client'

// pullImageStream is loaded dynamically to avoid importing the real dockerFetch before
// any spy setup. The module is cached after first import, so all tests share one instance.
let pullImageStream: (imageTag: string, logFn: (line: string) => void) => Promise<void>

beforeAll(async () => {
  const mod = await import('../docker/api')
  pullImageStream = mod.pullImageStream
})

// ---------------------------------------------------------------------------
// parseDockerHost
// ---------------------------------------------------------------------------

describe('parseDockerHost', () => {
  const saved = process.env.DOCKER_HOST

  afterEach(() => {
    if (saved === undefined)
      delete process.env.DOCKER_HOST
    else
      process.env.DOCKER_HOST = saved
  })

  it('defaults to unix socket when DOCKER_HOST is unset', () => {
    delete process.env.DOCKER_HOST
    expect(parseDockerHost()).toEqual({ type: 'unix', path: '/var/run/docker.sock' })
  })

  it('parses unix:// with default socket path', () => {
    process.env.DOCKER_HOST = 'unix:///var/run/docker.sock'
    expect(parseDockerHost()).toEqual({ type: 'unix', path: '/var/run/docker.sock' })
  })

  it('parses unix:// with a custom socket path', () => {
    process.env.DOCKER_HOST = 'unix:///tmp/custom.sock'
    expect(parseDockerHost()).toEqual({ type: 'unix', path: '/tmp/custom.sock' })
  })

  it('parses tcp:// host and port', () => {
    process.env.DOCKER_HOST = 'tcp://socket-proxy:2375'
    expect(parseDockerHost()).toEqual({ type: 'tcp', baseUrl: 'http://socket-proxy:2375' })
  })

  it('parses tcp:// with IP address', () => {
    process.env.DOCKER_HOST = 'tcp://192.168.1.1:2376'
    expect(parseDockerHost()).toEqual({ type: 'tcp', baseUrl: 'http://192.168.1.1:2376' })
  })

  it('throws for unsupported DOCKER_HOST scheme', () => {
    process.env.DOCKER_HOST = 'http://invalid:2375'
    expect(() => parseDockerHost()).toThrow('Unsupported DOCKER_HOST format')
  })
})

// ---------------------------------------------------------------------------
// pullImageStream
// ---------------------------------------------------------------------------

function makeNdjsonStream(events: object[]): Response {
  const encoder = new TextEncoder()
  const body = `${events.map(e => JSON.stringify(e)).join('\n')}\n`
  const bytes = encoder.encode(body)
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('pullImageStream', () => {
  afterEach(() => {
    // Ensure no spy leaks between tests
  })

  it('logs only high-level pull events, filters per-layer noise', async () => {
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(makeNdjsonStream([
      { status: 'Pulling from registry/myapp', id: 'latest' },
      { status: 'Pulling fs layer', id: 'abc' },
      { status: 'Waiting', id: 'abc' },
      { status: 'Downloading', progress: '[=>   ] 1B/10B', id: 'abc' },
      { status: 'Verifying Checksum', id: 'abc' },
      { status: 'Download complete', id: 'abc' },
      { status: 'Extracting', progress: '[=======>  ] 5B/10B', id: 'abc' },
      { status: 'Pull complete', id: 'abc' },
      { status: 'Digest: sha256:abc123' },
      { status: 'Status: Downloaded newer image for registry/myapp:v1' },
    ]))
    const logs: string[] = []
    await pullImageStream('registry.example.com/myapp:v1', line => logs.push(line))
    expect(logs).toContain('Pulling from registry/myapp')
    expect(logs).toContain('Pull complete')
    expect(logs).toContain('Digest: sha256:abc123')
    expect(logs).toContain('Status: Downloaded newer image for registry/myapp:v1')
    // Per-layer noise must be filtered
    expect(logs).not.toContain('Pulling fs layer')
    expect(logs).not.toContain('Waiting')
    expect(logs).not.toContain('Verifying Checksum')
    expect(logs).not.toContain('Download complete')
    expect(logs).not.toContain('Extracting')
    expect(logs.some(l => l.includes('[=>'))).toBe(false)
    spy.mockRestore()
  })

  it('throws on Docker pull error event in stream', async () => {
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(makeNdjsonStream([
      { status: 'Pulling from registry/myapp' },
      { error: 'manifest for registry/myapp:notexist not found' },
    ]))
    await expect(
      pullImageStream('registry.example.com/myapp:notexist', () => {}),
    ).rejects.toThrow('Docker pull error: manifest for registry/myapp:notexist not found')
    spy.mockRestore()
  })

  it('throws when Docker API returns non-2xx', async () => {
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"image not found"}', { status: 404 }),
    )
    await expect(
      pullImageStream('registry.example.com/myapp:notexist', () => {}),
    ).rejects.toThrow('Docker pull failed (404)')
    spy.mockRestore()
  })

  it('handles already-up-to-date image', async () => {
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(makeNdjsonStream([
      { status: 'Already exists', id: 'layer1' },
      { status: 'Already exists', id: 'layer2' },
      { status: 'Digest: sha256:abc123' },
      { status: 'Status: Image is up to date for registry/myapp:v1' },
    ]))
    const logs: string[] = []
    await pullImageStream('registry.example.com/myapp:v1', line => logs.push(line))
    expect(logs).toContain('Already exists')
    expect(logs).toContain('Status: Image is up to date for registry/myapp:v1')
    spy.mockRestore()
  })

  it('handles digest-only image tag — passes full reference as fromImage', async () => {
    const digest = `registry.example.com/myapp@sha256:${'a'.repeat(64)}`
    let capturedUrl = ''
    // eslint-disable-next-line ts/no-unsafe-argument
    const spy = spyOn(globalThis, 'fetch').mockImplementation(((url: string | URL | Request) => {
      capturedUrl = String(url)
      return Promise.resolve(makeNdjsonStream([
        { status: 'Status: Image is up to date' },
      ]))
    }) as typeof fetch)
    const logs: string[] = []
    await pullImageStream(digest, line => logs.push(line))
    // Full digest reference must appear in fromImage param, not be split incorrectly
    expect(capturedUrl).toContain('fromImage=')
    expect(capturedUrl).toContain('sha256')
    expect(capturedUrl).not.toContain('tag=')
    expect(logs).toContain('Status: Image is up to date')
    spy.mockRestore()
  })

  it('skips malformed NDJSON lines without throwing', async () => {
    const encoder = new TextEncoder()
    const body = [
      JSON.stringify({ status: 'Pulling from registry/myapp' }),
      'not-valid-json',
      JSON.stringify({ status: 'Pull complete', id: 'abc' }),
      '{"broken":',
    ].join('\n')
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(body))
        c.close()
      },
    })
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }))
    const logs: string[] = []
    await expect(
      pullImageStream('registry.example.com/myapp:v1', line => logs.push(line)),
    ).resolves.toBeUndefined()
    expect(logs).toContain('Pulling from registry/myapp')
    spy.mockRestore()
  })

  it('handles empty response body gracefully', async () => {
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    await expect(
      pullImageStream('registry.example.com/myapp:v1', () => {}),
    ).resolves.toBeUndefined()
    spy.mockRestore()
  })
})
