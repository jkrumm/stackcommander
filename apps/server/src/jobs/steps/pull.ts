import { appendFileSync } from 'node:fs'
import { pullImageStream } from '@/docker/api'

export async function pullImage(imageTag: string, logPath: string): Promise<void> {
  const log = (line: string) => appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)

  log(`[pull] Pulling image: ${imageTag}`)
  await pullImageStream(imageTag, line => log(`[pull] ${line}`))
  log(`[pull] Image pulled successfully: ${imageTag}`)
}
