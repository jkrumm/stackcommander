import process from 'node:process'

export function parseDockerHost(): { type: 'unix', path: string } | { type: 'tcp', baseUrl: string } {
  const dockerHost = process.env.DOCKER_HOST
  if (!dockerHost || dockerHost.startsWith('unix://')) {
    const socketPath = dockerHost ? dockerHost.slice('unix://'.length) : '/var/run/docker.sock'
    return { type: 'unix', path: socketPath }
  }
  if (dockerHost.startsWith('tcp://')) {
    return { type: 'tcp', baseUrl: `http://${dockerHost.slice('tcp://'.length)}` }
  }
  throw new Error(`Unsupported DOCKER_HOST format: ${dockerHost}`)
}

export async function dockerFetch(path: string, options?: RequestInit): Promise<Response> {
  const host = parseDockerHost()

  // Apply a 30s default timeout for Docker API calls.
  // Callers that need longer timeouts (e.g., streaming pulls) must pass an explicit signal.
  const hasCallerSignal = options?.signal !== undefined
  const controller = hasCallerSignal ? null : new AbortController()
  const timeoutId = controller ? setTimeout(() => controller.abort(), 30_000) : undefined
  const signal = hasCallerSignal ? options!.signal : controller!.signal

  try {
    if (host.type === 'unix')
      return await fetch(`http://localhost${path}`, { ...options, signal, unix: host.path })
    return await fetch(`${host.baseUrl}${path}`, { ...options, signal })
  }
  finally {
    clearTimeout(timeoutId)
  }
}
