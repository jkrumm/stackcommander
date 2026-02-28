import type { ContainerSummary } from '@/docker/types'
import { appendFileSync } from 'node:fs'
import { inspectContainer, listContainersByImage } from '@/docker/api'

// Exported for unit testing — pure parsing helpers with no side effects.

export function extractImageName(imageTag: string): string {
  // Strip only the tag portion (after the last `/`, find the first `:`)
  // Preserves port numbers in registry hostnames, e.g. localhost:5001/image:tag → localhost:5001/image
  const lastSlash = imageTag.lastIndexOf('/')
  const afterLastSlash = imageTag.slice(lastSlash + 1)
  const tagStart = afterLastSlash.indexOf(':')
  if (tagStart < 0)
    return imageTag
  return imageTag.slice(0, lastSlash + 1 + tagStart)
}

export function findMatchingContainerId(
  containers: ContainerSummary[],
  imageName: string,
): { id: string, name: string } | null {
  for (const container of containers) {
    // Match containers whose image is exactly `imageName` (bare) or `imageName:tag`
    if (container.Image === imageName || container.Image.startsWith(`${imageName}:`)) {
      const name = (container.Names[0] ?? '').replace(/^\//, '')
      return { id: container.Id, name }
    }
  }
  return null
}

export function extractComposeInfo(
  labels: Record<string, string> | null,
  containerName: string,
): { composePath: string, service: string, project: string } {
  if (!labels)
    throw new Error(`Container ${containerName} has no Docker labels — not started via docker compose`)

  // config_files may list multiple comma-separated paths when using -f overrides; take the first
  const composePath = (labels['com.docker.compose.project.config_files'] ?? '').split(',')[0]?.trim()
  const service = labels['com.docker.compose.service']
  const project = labels['com.docker.compose.project']

  if (!composePath)
    throw new Error(`Container ${containerName} is missing 'config_files' label — not started via docker compose`)

  if (!service)
    throw new Error(`Container ${containerName} is missing 'service' label — not started via docker compose`)

  if (!project)
    throw new Error(`Container ${containerName} is missing 'project' label — not started via docker compose`)

  return { composePath, service, project }
}

export async function discover(imageTag: string, app: string, logPath: string): Promise<{ composePath: string, service: string, project: string }> {
  const log = (line: string) => appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)
  const imageName = extractImageName(imageTag)

  log(`[discover] Searching for containers using image: ${imageName}`)

  const containers = await listContainersByImage(imageName)
  const match = findMatchingContainerId(containers, imageName)

  if (!match) {
    log(`[discover] No running containers found matching image: ${imageName}`)
    log(`[discover] Hint: Ensure the service was started at least once before using rollhook`)
    log(`[discover] Hint: Run 'docker ps' on your server to verify the container is running`)
    log(`[discover] Hint: The image registry prefix must match exactly what Docker shows for the running container`)
    log(`[discover] Hint: To verify: docker ps --filter ancestor=${imageName} (check image names match)`)
    throw new Error(`No running container found matching image: ${imageName}`)
  }

  log(`[discover] Found container: ${match.name} (ID: ${match.id.slice(0, 12)})`)

  const detail = await inspectContainer(match.id)
  const { composePath, service, project } = extractComposeInfo(detail.Config.Labels, match.name)

  log(`[discover] Compose file: ${composePath}`)
  log(`[discover] Service: ${service}`)
  log(`[discover] Discovery complete`)

  return { composePath, service, project }
}
