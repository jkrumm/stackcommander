import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { validateCompose } from '../jobs/steps/validate'

const TMP_DIR = join(tmpdir(), `rollhook-validate-test-${Date.now()}`)

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
    expect(() => validateCompose(composePath, makeLogPath('valid'))).not.toThrow()
  })

  it('throws when compose_path is relative', () => {
    expect(() => validateCompose('./compose.yml', makeLogPath('relative'))).toThrow('must be absolute')
  })

  it('throws when compose_path does not exist', () => {
    const nonexistent = join(TMP_DIR, 'nonexistent', 'compose.yml')
    expect(() => validateCompose(nonexistent, makeLogPath('not-found'))).toThrow('Compose file not found')
  })
})
