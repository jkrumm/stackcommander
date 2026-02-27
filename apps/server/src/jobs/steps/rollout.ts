import { appendFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

// Resolve docker binary once at module load. When Bun.spawn receives an
// explicit `env` object, it uses posix_spawnp which resolves executables via
// the PATH in the provided env — but there is an intermittent Bun bug where
// this fails on the first invocation. Using an absolute path avoids the issue.
const DOCKER_BIN = Bun.which('docker') ?? 'docker'

// Note: steps always run sequentially (post-MVP: dependency graph)
export async function rolloutApp(
  composePath: string,
  steps: Array<{ service: string }>,
  imageTag: string,
  logPath: string,
): Promise<void> {
  const log = (line: string) => appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)
  const cwd = dirname(composePath)

  // Bun intermittent bug: the first Bun.spawn call with an explicit env object may
  // throw ENOENT even when the binary path is absolute. A harmless warmup primes the
  // posix_spawn machinery so the actual rollout calls succeed.
  try {
    const warmup = Bun.spawn([DOCKER_BIN, '--version'], {
      env: { ...process.env },
      stdout: 'ignore',
      stderr: 'ignore',
    })
    await warmup.exited
  }
  catch { /* absorb warmup ENOENT — subsequent spawns will succeed */ }

  for (const step of steps) {
    log(`[rollout] Rolling out service: ${step.service} (IMAGE_TAG=${imageTag})`)

    const proc = Bun.spawn([DOCKER_BIN, 'rollout', step.service, '-f', composePath], {
      cwd,
      env: { ...process.env, IMAGE_TAG: imageTag },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [exitCode, , stderr] = await Promise.all([
      proc.exited,
      (async () => {
        const reader = proc.stdout.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done)
            break
          log(decoder.decode(value))
        }
      })(),
      new Response(proc.stderr).text(),
    ])

    if (exitCode !== 0)
      throw new Error(`docker rollout failed for ${step.service} (exit ${exitCode}): ${stderr}`)

    log(`[rollout] Service ${step.service} rolled out successfully`)
  }
}
