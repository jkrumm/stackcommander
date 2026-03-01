import type { ContainerDetail, ContainerSummary } from '@/docker/types'
import { dockerFetch } from '@/docker/client'

// Only log high-level pull events — not per-layer Downloading/Extracting/Waiting noise.
// A typical image with 20 layers emits 100+ lines without this filter.
const PULL_LOG_PREFIXES = ['Pulling from', 'Pull complete', 'Already exists', 'Digest:', 'Status:']

export async function listRunningContainers(): Promise<ContainerSummary[]> {
  const res = await dockerFetch('/containers/json')
  if (!res.ok)
    throw new Error(`Docker API error listing containers: ${res.status} ${await res.text()}`)
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
  // Digest-only references (image@sha256:hash) are passed whole as fromImage.
  // For tagged references, split at the last colon after the last slash.
  let fromImage: string
  let tag: string | undefined

  const digestIdx = imageTag.indexOf('@sha256:')
  if (digestIdx >= 0) {
    fromImage = imageTag
    tag = undefined
  }
  else {
    const lastSlash = imageTag.lastIndexOf('/')
    const afterSlash = imageTag.slice(lastSlash + 1)
    const colonIdx = afterSlash.lastIndexOf(':')
    if (colonIdx >= 0) {
      fromImage = imageTag.slice(0, lastSlash + 1 + colonIdx)
      tag = afterSlash.slice(colonIdx + 1)
    }
    else {
      fromImage = imageTag
      tag = 'latest'
    }
  }

  const params = new URLSearchParams(tag !== undefined ? { fromImage, tag } : { fromImage })
  const res = await dockerFetch(`/images/create?${params}`, {
    method: 'POST',
    signal: AbortSignal.timeout(10 * 60 * 1000), // 10 min — pulls can be slow for large images
  })
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
        const parsed = JSON.parse(line)
        if (typeof parsed !== 'object' || parsed === null)
          continue
        const event = parsed as { status?: string, error?: string }
        if (event.error)
          throw new Error(`Docker pull error: ${event.error}`)
        if (event.status && PULL_LOG_PREFIXES.some(p => event.status!.startsWith(p)))
          logFn(event.status)
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
