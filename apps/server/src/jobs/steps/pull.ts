import { appendFileSync } from 'node:fs'

export async function pullImage(imageTag: string, logPath: string): Promise<void> {
  const log = (line: string) => appendFileSync(logPath, `${line}\n`)

  log(`[pull] Pulling image: ${imageTag}`)

  const proc = Bun.spawn(['docker', 'pull', imageTag], {
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
    throw new Error(`docker pull failed (exit ${exitCode}): ${stderr}`)

  log(`[pull] Image pulled successfully: ${imageTag}`)
}
