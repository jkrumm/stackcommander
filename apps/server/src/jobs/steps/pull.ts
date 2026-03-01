import { appendFileSync } from 'node:fs'
import { getZotPassword, ZOT_USER } from '@/registry/config'
import { pullImageStream } from '@/docker/api'

export async function pullImage(imageTag: string, logPath: string): Promise<void> {
  const log = (line: string) => appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)

  log(`[pull] Pulling image: ${imageTag}`)

  // For localhost registries (our embedded Zot), pass X-Registry-Auth so the Docker daemon
  // can authenticate without relying on its credential store (which may not have localhost creds
  // accessible via the API, e.g. on macOS where credentials are in the keychain).
  const slashIdx = imageTag.indexOf('/')
  const registryHost = slashIdx >= 0 ? imageTag.slice(0, slashIdx) : ''
  let xRegistryAuth: string | undefined
  if (registryHost.startsWith('localhost:') || registryHost.startsWith('127.0.0.1:')) {
    xRegistryAuth = btoa(JSON.stringify({ username: ZOT_USER, password: getZotPassword(), serveraddress: registryHost }))
  }

  await pullImageStream(imageTag, line => log(`[pull] ${line}`), xRegistryAuth)
  log(`[pull] Image pulled successfully: ${imageTag}`)
}
