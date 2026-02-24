import type { ServerConfig } from 'rollhook'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { Value } from '@sinclair/typebox/value'
import yaml from 'js-yaml'
import { ServerConfigSchema } from 'rollhook'

const CONFIG_PATH = join(process.cwd(), 'rollhook.config.yaml')

let cached: ServerConfig | null = null

export function loadConfig(): ServerConfig {
  if (cached)
    return cached

  const raw = readFileSync(CONFIG_PATH, 'utf-8')
  const parsed = yaml.load(raw)

  if (!Value.Check(ServerConfigSchema, parsed)) {
    const errors = [...Value.Errors(ServerConfigSchema, parsed)]
    throw new Error(`Invalid rollhook.config.yaml:\n${errors.map(e => `  ${e.path}: ${e.message}`).join('\n')}`)
  }

  cached = parsed as ServerConfig
  return cached
}
