import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inspectContainer, listServiceContainers, removeContainer, stopContainer } from '@/docker/api'

const HEALTH_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 1_000

function setEnvLine(content: string, key: string, value: string): string {
  const keyPrefix = `${key}=`
  const newLine = `${key}=${value}`
  const lines = content.split('\n')
  const idx = lines.findIndex(l => l.startsWith(keyPrefix))
  if (idx >= 0) {
    lines[idx] = newLine
  }
  else {
    // Insert before trailing empty line to keep the file's trailing newline intact
    const lastIsEmpty = lines[lines.length - 1] === ''
    if (lastIsEmpty)
      lines.splice(lines.length - 1, 0, newLine)
    else
      lines.push(newLine)
  }
  return lines.join('\n')
}

export async function rolloutApp(
  composePath: string,
  service: string,
  project: string,
  imageTag: string,
  logPath: string,
): Promise<void> {
  const log = (line: string) => appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)
  const cwd = dirname(composePath)

  // Merge IMAGE_TAG into a job-scoped temp env file — never touch the user's .env.
  // Docker Compose v2 .env takes precedence over shell env; using --env-file with a
  // temp file overrides it without mutating the user's project directory.
  const userDotEnvPath = join(cwd, '.env')
  const userDotEnv = existsSync(userDotEnvPath) ? readFileSync(userDotEnvPath, 'utf8') : ''
  const mergedEnv = setEnvLine(userDotEnv, 'IMAGE_TAG', imageTag)
  const tmpEnvFile = join(tmpdir(), `rollhook-${crypto.randomUUID()}.env`)
  writeFileSync(tmpEnvFile, mergedEnv)

  try {
    // 1. Capture old container IDs before scale-up
    const oldContainers = await listServiceContainers(project, service)
    const oldIds = new Set(oldContainers.map(c => c.Id))
    const scaleCount = Math.max(oldIds.size, 1) * 2

    log(`[rollout] Rolling out service: ${service} (IMAGE_TAG=${imageTag})`)
    log(`[rollout] Scaling service ${service} from ${oldIds.size}→${scaleCount} replicas`)

    // 2. Scale up via docker compose — the only remaining subprocess
    const scaleProc = Bun.spawn([
      'docker',
      'compose',
      '-f',
      composePath,
      '--env-file',
      tmpEnvFile,
      'up',
      '-d',
      '--no-recreate',
      '--scale',
      `${service}=${scaleCount}`,
    ], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [scaleExit, , scaleStderr] = await Promise.all([
      scaleProc.exited,
      new Response(scaleProc.stdout).text(),
      new Response(scaleProc.stderr).text(),
    ])

    if (scaleExit !== 0)
      throw new Error(`docker compose up --scale failed (exit ${scaleExit}): ${scaleStderr}`)

    // 3. Identify new containers (all current minus old)
    const allContainers = await listServiceContainers(project, service)
    const newContainers = allContainers.filter(c => !oldIds.has(c.Id))

    if (newContainers.length === 0)
      throw new Error(`Scale-up produced no new containers for service ${service}`)

    log(`[rollout] Waiting for ${newContainers.length} new container(s) to become healthy`)

    // 4. Wait for all new containers to become healthy
    const deadline = Date.now() + HEALTH_TIMEOUT_MS

    for (let i = 0; i < newContainers.length; i++) {
      const container = newContainers[i]!
      log(`[rollout] Waiting for container ${container.Id.slice(0, 12)} to become healthy (${i + 1}/${newContainers.length})`)
      const containerStart = Date.now()

      while (true) {
        if (Date.now() > deadline) {
          await rollback(newContainers.map(c => c.Id), 'health check timed out', log)
          throw new Error(`Rolling deploy timed out: new containers did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s`)
        }

        const detail = await inspectContainer(container.Id)
        const health = detail.State.Health

        if (health === null)
          throw new Error(`Container ${container.Id.slice(0, 12)} has no healthcheck — healthcheck is required for zero-downtime deploys`)

        if (health.Status === 'healthy') {
          const elapsed = ((Date.now() - containerStart) / 1000).toFixed(1)
          log(`[rollout] Container ${container.Id.slice(0, 12)} healthy after ${elapsed}s`)
          break
        }

        if (health.Status === 'unhealthy') {
          await rollback(newContainers.map(c => c.Id), 'container became unhealthy', log)
          throw new Error(`Rolling deploy failed: container ${container.Id.slice(0, 12)} became unhealthy`)
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      }
    }

    // 5. All new containers healthy — drain old containers
    for (const oldId of oldIds) {
      log(`[rollout] Draining old container ${oldId.slice(0, 12)}`)
      await stopContainer(oldId)
      await removeContainer(oldId)
    }

    log(`[rollout] Service ${service} rolled out successfully`)
  }
  finally {
    try {
      rmSync(tmpEnvFile)
    }
    catch {}
  }
}

async function rollback(newIds: string[], reason: string, log: (line: string) => void): Promise<void> {
  log(`[rollout] Rollback triggered: ${reason}`)
  for (const id of newIds) {
    log(`[rollout] Rollback: stopping new container ${id.slice(0, 12)}`)
    try {
      await stopContainer(id)
      await removeContainer(id)
    }
    catch (e) {
      log(`[rollout] Rollback cleanup error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
