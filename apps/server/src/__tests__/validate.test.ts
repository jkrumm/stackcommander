import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateCompose } from '../jobs/steps/validate'

const TMP_DIR = join(tmpdir(), `rollhook-validate-test-${Date.now()}`)
const VALID_IMAGE_TAG = 'registry.example.com/app:v1.2'

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true })
})

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true })
})

function makeLogPath(name: string): string {
  const logPath = join(TMP_DIR, `${name}.log`)
  writeFileSync(logPath, '')
  return logPath
}

describe('validateCompose', () => {
  it('accepts valid absolute compose_path', () => {
    const composePath = join(TMP_DIR, 'compose.yml')
    writeFileSync(composePath, 'services:\n  backend:\n    image: nginx\n')
    expect(() => validateCompose(composePath, VALID_IMAGE_TAG, makeLogPath('valid'))).not.toThrow()
  })

  it('throws when compose_path is relative', () => {
    expect(() => validateCompose('./compose.yml', VALID_IMAGE_TAG, makeLogPath('relative'))).toThrow('must be absolute')
  })

  it('throws when compose_path does not exist', () => {
    const nonexistent = join(TMP_DIR, 'nonexistent', 'compose.yml')
    expect(() => validateCompose(nonexistent, VALID_IMAGE_TAG, makeLogPath('not-found'))).toThrow('Compose file not found')
  })

  it('throws when imageTag contains spaces', () => {
    const composePath = join(TMP_DIR, 'compose.yml')
    expect(() => validateCompose(composePath, 'image with spaces', makeLogPath('spaces'))).toThrow('Invalid image tag format')
  })

  it('throws when imageTag contains shell metacharacters', () => {
    const composePath = join(TMP_DIR, 'compose.yml')
    expect(() => validateCompose(composePath, 'image;rm -rf /', makeLogPath('injection'))).toThrow('Invalid image tag format')
  })

  it('accepts imageTag with sha256 digest', () => {
    const composePath = join(TMP_DIR, 'compose.yml')
    writeFileSync(composePath, 'services:\n  backend:\n    image: nginx\n')
    const tag = `registry.example.com/app@sha256:${'a'.repeat(64)}`
    expect(() => validateCompose(composePath, tag, makeLogPath('sha256'))).not.toThrow()
  })

  it('accepts simple image:tag without registry', () => {
    const composePath = join(TMP_DIR, 'compose.yml')
    writeFileSync(composePath, 'services:\n  backend:\n    image: nginx\n')
    expect(() => validateCompose(composePath, 'nginx:latest', makeLogPath('simple'))).not.toThrow()
  })
})
