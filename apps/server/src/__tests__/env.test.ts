import { describe, expect, it } from 'bun:test'
import { setEnvLine } from '../utils/env'

describe('setEnvLine', () => {
  it('replaces an existing key', () => {
    expect(setEnvLine('IMAGE_TAG=v1\n', 'IMAGE_TAG', 'v2')).toBe('IMAGE_TAG=v2\n')
  })

  it('appends to empty content', () => {
    expect(setEnvLine('', 'IMAGE_TAG', 'v1')).toBe('IMAGE_TAG=v1')
  })

  it('appends to content with no trailing newline', () => {
    expect(setEnvLine('OTHER=x', 'IMAGE_TAG', 'v1')).toBe('OTHER=x\nIMAGE_TAG=v1')
  })

  it('inserts before trailing newline to preserve it', () => {
    expect(setEnvLine('OTHER=x\n', 'IMAGE_TAG', 'v1')).toBe('OTHER=x\nIMAGE_TAG=v1\n')
  })

  it('replaces mid-file key, preserving surrounding lines', () => {
    const content = 'A=1\nIMAGE_TAG=old\nB=2\n'
    expect(setEnvLine(content, 'IMAGE_TAG', 'new')).toBe('A=1\nIMAGE_TAG=new\nB=2\n')
  })

  it('does not match a commented-out key', () => {
    const content = '#IMAGE_TAG=old\n'
    expect(setEnvLine(content, 'IMAGE_TAG', 'v2')).toBe('#IMAGE_TAG=old\nIMAGE_TAG=v2\n')
  })

  it('does not match a key that is a prefix of another key', () => {
    const content = 'IMAGE_TAG_EXTRA=foo\n'
    expect(setEnvLine(content, 'IMAGE_TAG', 'v2')).toBe('IMAGE_TAG_EXTRA=foo\nIMAGE_TAG=v2\n')
  })

  it('handles empty replacement value', () => {
    expect(setEnvLine('IMAGE_TAG=v1\n', 'IMAGE_TAG', '')).toBe('IMAGE_TAG=\n')
  })

  it('handles a key with no value (KEY= form)', () => {
    expect(setEnvLine('IMAGE_TAG=\n', 'IMAGE_TAG', 'v2')).toBe('IMAGE_TAG=v2\n')
  })

  it('replaces the last occurrence when duplicate keys exist', () => {
    const content = 'IMAGE_TAG=v1\nIMAGE_TAG=also-old\n'
    expect(setEnvLine(content, 'IMAGE_TAG', 'v2')).toBe('IMAGE_TAG=v1\nIMAGE_TAG=v2\n')
  })

  it('appends a new key alongside unrelated content', () => {
    const content = 'PORT=3000\nNODE_ENV=production\n'
    expect(setEnvLine(content, 'IMAGE_TAG', 'v1')).toBe('PORT=3000\nNODE_ENV=production\nIMAGE_TAG=v1\n')
  })
})
