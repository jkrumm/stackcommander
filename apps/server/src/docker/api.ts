import type { ContainerDetail, ContainerSummary } from '@/docker/types'
import { dockerFetch } from '@/docker/client'

export async function listContainersByImage(imageName: string): Promise<ContainerSummary[]> {
  const filters = encodeURIComponent(JSON.stringify({ ancestor: [imageName] }))
  const res = await dockerFetch(`/containers/json?filters=${filters}`)
  if (!res.ok)
    throw new Error(`Docker API error listing containers by image: ${res.status} ${await res.text()}`)
  return res.json() as Promise<ContainerSummary[]>
}

export async function inspectContainer(id: string): Promise<ContainerDetail> {
  const res = await dockerFetch(`/containers/${id}/json`)
  if (!res.ok)
    throw new Error(`Docker API error inspecting container ${id.slice(0, 12)}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<ContainerDetail>
}

export async function listServiceContainers(project: string, service: string): Promise<ContainerSummary[]> {
  const filters = encodeURIComponent(JSON.stringify({
    label: [
      `com.docker.compose.project=${project}`,
      `com.docker.compose.service=${service}`,
    ],
  }))
  const res = await dockerFetch(`/containers/json?filters=${filters}`)
  if (!res.ok)
    throw new Error(`Docker API error listing service containers: ${res.status} ${await res.text()}`)
  return res.json() as Promise<ContainerSummary[]>
}

export async function pullImageStream(imageTag: string, logFn: (line: string) => void): Promise<void> {
  // Split imageTag into fromImage + tag for the Docker API
  const lastSlash = imageTag.lastIndexOf('/')
  const afterSlash = imageTag.slice(lastSlash + 1)
  const colonIdx = afterSlash.lastIndexOf(':')

  let fromImage: string
  let tag: string
  if (colonIdx >= 0) {
    fromImage = imageTag.slice(0, lastSlash + 1 + colonIdx)
    tag = afterSlash.slice(colonIdx + 1)
  }
  else {
    fromImage = imageTag
    tag = 'latest'
  }

  const params = new URLSearchParams({ fromImage, tag })
  const res = await dockerFetch(`/images/create?${params}`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Docker pull failed (${res.status}): ${body}`)
  }

  if (!res.body)
    return

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim())
        continue
      try {
        const event = JSON.parse(line) as { status?: string, error?: string, progress?: string }
        if (event.error)
          throw new Error(`Docker pull error: ${event.error}`)
        if (event.status) {
          const msg = event.progress ? `${event.status} ${event.progress}` : event.status
          logFn(msg)
        }
      }
      catch (e) {
        if (e instanceof Error && e.message.startsWith('Docker pull error'))
          throw e
        // Skip malformed NDJSON lines
      }
    }
  }
}

export async function stopContainer(id: string): Promise<void> {
  const res = await dockerFetch(`/containers/${id}/stop`, { method: 'POST' })
  // 304 = already stopped, both are fine
  if (!res.ok && res.status !== 304)
    throw new Error(`Docker API error stopping container ${id.slice(0, 12)}: ${res.status} ${await res.text()}`)
}

export async function removeContainer(id: string): Promise<void> {
  const res = await dockerFetch(`/containers/${id}`, { method: 'DELETE' })
  // 404 = already removed, that's fine
  if (!res.ok && res.status !== 404)
    throw new Error(`Docker API error removing container ${id.slice(0, 12)}: ${res.status} ${await res.text()}`)
}
