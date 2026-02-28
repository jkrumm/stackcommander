import { appendFileSync, existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

// Accepts: [registry[:port]/][namespace/]image[:tag|@sha256:digest]
// Rejects: spaces, shell metacharacters, newlines, null bytes
const IMAGE_TAG_RE = /^[a-z0-9][\w.\-:/]*(?:@sha256:[a-f0-9]{64})?$/i

export function validateCompose(composePath: string, imageTag: string, logPath: string): void {
  const log = (line: string) => appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)
  log('[validate] Validating deployment parameters')

  if (!IMAGE_TAG_RE.test(imageTag))
    throw new Error(`Invalid image tag format: ${imageTag}`)

  if (!isAbsolute(composePath))
    throw new Error(`compose_path must be absolute, got: ${composePath}`)

  if (!existsSync(composePath))
    throw new Error(`Compose file not found: ${composePath}`)

  log(`[validate] OK — ${composePath}`)
}
