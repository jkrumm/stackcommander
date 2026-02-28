import type { ChildProcess } from 'node:child_process'
import { execSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ADMIN_TOKEN, REGISTRY_HOST, WEBHOOK_TOKEN } from './fixtures.ts'

const DIR = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(DIR, '../..')
const E2E_DIR = join(ROOT, 'e2e')
const HELLO_WORLD_DIR = join(ROOT, 'examples/bun-hello-world')

let serverProcess: ChildProcess | null = null

export async function setup(): Promise<void> {
  // Tear down any stale state from a previous crashed run before starting fresh
  execSync(`docker compose --project-directory ${HELLO_WORLD_DIR} down -v 2>/dev/null || true`)
  execSync(`docker compose -f ${E2E_DIR}/compose.e2e.yml --project-name rollhook-e2e down -v 2>/dev/null || true`)
  // Kill any stale rollhook server left behind by a previous interrupted run
  execSync(`lsof -ti :7700 | xargs kill -9 2>/dev/null || true`)

  // Start infrastructure (Traefik + local registry)
  execSync(`docker compose -f ${E2E_DIR}/compose.e2e.yml --project-name rollhook-e2e up -d`, {
    stdio: 'inherit',
  })

  // Wait for registry to be ready
  await waitForUrl('http://localhost:5001/v2/', 30_000)

  // Build images
  execSync(
    `docker build -t rollhook-e2e-hello:v1 --build-arg BUILD_VERSION=v1 ${HELLO_WORLD_DIR}`,
    { stdio: 'inherit' },
  )
  execSync(
    `docker build -t rollhook-e2e-hello:v2 --build-arg BUILD_VERSION=v2 ${HELLO_WORLD_DIR}`,
    { stdio: 'inherit' },
  )

  // Push images to local registry so executor's docker pull step succeeds
  execSync(`docker tag rollhook-e2e-hello:v1 ${REGISTRY_HOST}/rollhook-e2e-hello:v1`)
  execSync(`docker push ${REGISTRY_HOST}/rollhook-e2e-hello:v1`, { stdio: 'inherit' })
  execSync(`docker tag rollhook-e2e-hello:v2 ${REGISTRY_HOST}/rollhook-e2e-hello:v2`)
  execSync(`docker push ${REGISTRY_HOST}/rollhook-e2e-hello:v2`, { stdio: 'inherit' })

  // Start hello-world app at v1
  // compose.yml default `${IMAGE_TAG:-localhost:5001/rollhook-e2e-hello:v1}` handles initial startup
  execSync(`docker compose --project-directory ${HELLO_WORLD_DIR} up -d`, {
    stdio: 'inherit',
  })

  // Wait for hello-world to be routable through Traefik before starting any tests.
  // Traefik discovers container labels within ~100ms but needs its healthcheck to pass
  // before routing. Without this wait, zero-downtime "v1 is running" assertion can fail.
  await waitForUrl('http://localhost:9080/version', 30_000)

  // Spawn rollhook server natively
  serverProcess = spawn('bun', ['run', 'apps/server/server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ADMIN_TOKEN,
      WEBHOOK_TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout?.on('data', (chunk: Uint8Array) => {
    process.stdout.write(chunk)
  })
  serverProcess.stderr?.on('data', (chunk: Uint8Array) => {
    process.stderr.write(chunk)
  })
  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0)
      process.stderr.write(`[global] RollHook server exited with code ${code}\n`)
  })

  // Wait for server to be ready
  await waitForUrl('http://localhost:7700/health', 30_000)
}

export async function teardown(): Promise<void> {
  if (serverProcess) {
    const proc = serverProcess
    serverProcess = null
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 6_000)
      proc.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
      proc.kill()
    })
  }

  execSync(`docker compose --project-directory ${HELLO_WORLD_DIR} down -v`, {
    stdio: 'inherit',
  })
  execSync(
    `docker compose -f ${E2E_DIR}/compose.e2e.yml --project-name rollhook-e2e down -v`,
    { stdio: 'inherit' },
  )
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok)
        return
    }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Service did not become ready within ${timeoutMs}ms: ${url}`)
}
