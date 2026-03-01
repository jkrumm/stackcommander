import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { inspectContainer, listServiceContainers, removeContainer, stopContainer } from '@/docker/api'
import { setEnvLine } from '@/utils/env'

// Per-container health check timeout. Override via ROLLHOOK_HEALTH_TIMEOUT_MS env var.
const HEALTH_TIMEOUT_MS = Number(process.env.ROLLHOOK_HEALTH_TIMEOUT_MS) || 60_000
const POLL_INTERVAL_MS = 1_000

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
  // Docker Compose v2 .env takes precedence over shell env; --env-file with a temp
  // file overrides it without mutating the user's project directory.
  const userDotEnvPath = join(cwd, '.env')
  const userDotEnv = existsSync(userDotEnvPath) ? readFileSync(userDotEnvPath, 'utf8') : ''
  const mergedEnv = setEnvLine(userDotEnv, 'IMAGE_TAG', imageTag)
  const tmpEnvFile = join(tmpdir(), `rollhook-${crypto.randomUUID()}.env`)
  writeFileSync(tmpEnvFile, mergedEnv)

  try {
    // 1. Capture old container IDs before scale-up
    const oldContainers = await listServiceContainers(project, service)
    const oldIds = new Set(oldContainers.map(c => c.Id))
    // First deploy (no existing containers): start 1 replica, not 2
    const scaleCount = oldIds.size === 0 ? 1 : oldIds.size * 2

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

    const [scaleExit, scaleStdout, scaleStderr] = await Promise.all([
      scaleProc.exited,
      new Response(scaleProc.stdout).text(),
      new Response(scaleProc.stderr).text(),
    ])

    if (scaleStdout.trim())
      log(`[rollout] ${scaleStdout.trim()}`)

    if (scaleExit !== 0)
      throw new Error(`docker compose up --scale failed (exit ${scaleExit}): ${scaleStderr}`)

    // 3. Identify new containers — poll briefly to account for Docker API propagation delay
    let newContainers = await findNewContainers(project, service, oldIds)
    if (newContainers.length === 0) {
      // Docker API may not reflect new containers immediately after compose returns
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(r => setTimeout(r, 500))
        newContainers = await findNewContainers(project, service, oldIds)
        if (newContainers.length > 0)
          break
      }
    }

    if (newContainers.length === 0)
      throw new Error(`Scale-up produced no new containers for service ${service} after 5s`)

    log(`[rollout] Waiting for ${newContainers.length} new container(s) to become healthy`)

    // 4. Wait for each new container to become healthy — each gets its own timeout
    for (let i = 0; i < newContainers.length; i++) {
      const container = newContainers[i]!
      log(`[rollout] Waiting for container ${container.Id.slice(0, 12)} to become healthy (${i + 1}/${newContainers.length})`)
      const containerStart = Date.now()
      const containerDeadline = containerStart + HEALTH_TIMEOUT_MS

      while (true) {
        if (Date.now() > containerDeadline) {
          await rollback(newContainers.map(c => c.Id), 'health check timed out', log)
          throw new Error(`Rolling deploy timed out: container ${container.Id.slice(0, 12)} did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s`)
        }

        let detail
        try {
          detail = await inspectContainer(container.Id)
        }
        catch (inspectErr) {
          await rollback(newContainers.map(c => c.Id), 'container inspection failed', log)
          throw inspectErr
        }
        const health = detail.State.Health

        if (health === null)
          throw new Error(`Container ${container.Id.slice(0, 12)} has no healthcheck — add a healthcheck to your compose service for zero-downtime deploys`)

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
    // Note: we remove old containers via the Docker API directly. Docker Compose discovers
    // current state from labels on next run, so this does not corrupt compose state.
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
    catch (e) {
      log(`[rollout] Warning: failed to remove temp env file ${tmpEnvFile}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

async function findNewContainers(
  project: string,
  service: string,
  oldIds: Set<string>,
) {
  const all = await listServiceContainers(project, service)
  return all.filter(c => !oldIds.has(c.Id))
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
