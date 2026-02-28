import type { ContainerSummary } from '../docker/types'
import { describe, expect, it } from 'bun:test'
import { extractComposeInfo, extractImageName, findMatchingContainerId } from '../jobs/steps/discover'

function makeContainer(image: string, id = 'abc123', name = '/my-service'): ContainerSummary {
  return {
    Id: id,
    Image: image,
    Names: [name],
    Labels: {},
    State: 'running',
  }
}

function makeLabels(overrides?: Partial<Record<string, string>>): Record<string, string> {
  return {
    'com.docker.compose.project.config_files': '/srv/app/compose.yml',
    'com.docker.compose.service': 'hello-world',
    'com.docker.compose.project': 'myproject',
    ...overrides,
  }
}

describe('extractImageName', () => {
  it('strips tag from registry/image:tag', () => {
    expect(extractImageName('registry.example.com/app:v1.2')).toBe('registry.example.com/app')
  })

  it('strips only the last colon segment (tag)', () => {
    expect(extractImageName('localhost:5001/rollhook-e2e-hello:v1')).toBe('localhost:5001/rollhook-e2e-hello')
  })

  it('returns bare image name unchanged when no colon', () => {
    expect(extractImageName('myimage')).toBe('myimage')
  })

  it('strips tag from simple image:tag', () => {
    expect(extractImageName('nginx:latest')).toBe('nginx')
  })
})

describe('findMatchingContainerId', () => {
  it('returns match for image with tag', () => {
    const containers = [makeContainer('registry.example.com/app:v2', 'id-1', '/app-1')]
    const result = findMatchingContainerId(containers, 'registry.example.com/app')
    expect(result).toEqual({ id: 'id-1', name: 'app-1' })
  })

  it('strips leading slash from container name', () => {
    const containers = [makeContainer('myapp:latest', 'id-2', '/my-container')]
    const result = findMatchingContainerId(containers, 'myapp')
    expect(result?.name).toBe('my-container')
  })

  it('returns null when no container matches', () => {
    const containers = [makeContainer('other-image:v1')]
    const result = findMatchingContainerId(containers, 'my-app')
    expect(result).toBeNull()
  })

  it('returns null for empty container list', () => {
    expect(findMatchingContainerId([], 'my-app')).toBeNull()
  })

  it('matches bare image name (no tag on running container)', () => {
    const containers = [makeContainer('myapp', 'id-4', '/app')]
    const result = findMatchingContainerId(containers, 'myapp')
    expect(result?.id).toBe('id-4')
  })

  it('does not match partial image name prefix', () => {
    // 'my-app' should not match 'my-app-extra:v1'
    const containers = [makeContainer('my-app-extra:v1')]
    const result = findMatchingContainerId(containers, 'my-app')
    expect(result).toBeNull()
  })

  it('returns first match when multiple containers use same image', () => {
    const containers = [
      makeContainer('my-app:v1', 'id-first', '/app-1'),
      makeContainer('my-app:v1', 'id-second', '/app-2'),
    ]
    const result = findMatchingContainerId(containers, 'my-app')
    expect(result?.id).toBe('id-first')
  })

  it('tag stripping: registry/app:v1.2 → registry/app matches correctly', () => {
    const containers = [makeContainer('localhost:5001/rollhook-e2e-hello:v1', 'id-5', '/hello')]
    const result = findMatchingContainerId(containers, 'localhost:5001/rollhook-e2e-hello')
    expect(result?.id).toBe('id-5')
  })
})

describe('extractComposeInfo', () => {
  it('extracts composePath, service, and project from valid labels', () => {
    const result = extractComposeInfo(makeLabels(), 'my-container')
    expect(result.composePath).toBe('/srv/app/compose.yml')
    expect(result.service).toBe('hello-world')
    expect(result.project).toBe('myproject')
  })

  it('takes the first path when config_files is comma-separated', () => {
    const labels = makeLabels({
      'com.docker.compose.project.config_files': '/srv/app/compose.yml,/srv/app/compose.override.yml',
    })
    const result = extractComposeInfo(labels, 'my-container')
    expect(result.composePath).toBe('/srv/app/compose.yml')
  })

  it('throws for null labels (container not started via docker compose)', () => {
    expect(() => extractComposeInfo(null, 'plain-container')).toThrow(
      'has no Docker labels',
    )
  })

  it('throws when config_files label is missing', () => {
    const labels = makeLabels({
      'com.docker.compose.project.config_files': '',
    })
    expect(() => extractComposeInfo(labels, 'my-container')).toThrow(
      `missing 'config_files' label`,
    )
  })

  it('throws when service label is missing', () => {
    const labels = { 'com.docker.compose.project.config_files': '/srv/compose.yml', 'com.docker.compose.project': 'myproject' }
    expect(() => extractComposeInfo(labels, 'my-container')).toThrow(
      `missing 'service' label`,
    )
  })

  it('throws when project label is missing', () => {
    const labels = {
      'com.docker.compose.project.config_files': '/srv/compose.yml',
      'com.docker.compose.service': 'my-svc',
    }
    expect(() => extractComposeInfo(labels, 'my-container')).toThrow(
      `missing 'project' label`,
    )
  })

  it('throws when both labels are missing', () => {
    expect(() => extractComposeInfo({ 'some.other.label': 'value' }, 'my-container')).toThrow()
  })

  it('trims whitespace from composePath', () => {
    const labels = makeLabels({
      'com.docker.compose.project.config_files': '  /srv/app/compose.yml  ',
    })
    const result = extractComposeInfo(labels, 'my-container')
    expect(result.composePath).toBe('/srv/app/compose.yml')
  })
})
