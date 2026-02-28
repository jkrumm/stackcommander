import process from 'node:process'

function parseDockerHost(): { type: 'unix', path: string } | { type: 'tcp', baseUrl: string } {
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
  if (host.type === 'unix') {
    return fetch(`http://localhost${path}`, {
      ...options,
      unix: host.path,
    })
  }
  return fetch(`${host.baseUrl}${path}`, options)
}
