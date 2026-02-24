import type { AppConfig } from 'rollhook'
import { appendFileSync } from 'node:fs'

// Note: step.after is defined in the schema but steps always run sequentially (post-MVP: dependency graph)
export async function rolloutApp(clonePath: string, logPath: string, appConfig: AppConfig): Promise<void> {
  const log = (line: string) => appendFileSync(logPath, `${line}\n`)
  const composeFile = appConfig.compose_file ?? 'compose.yml'

  for (const step of appConfig.steps) {
    log(`[rollout] Rolling out service: ${step.service}`)

    const args = ['rollout', step.service, '-f', composeFile]
    if (step.wait_for_healthy)
      args.push('--wait')

    const proc = Bun.spawn(['docker', ...args], {
      cwd: clonePath,
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
