import type { AppConfig } from 'rollhook'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Value } from '@sinclair/typebox/value'
import yaml from 'js-yaml'
import { AppConfigSchema } from 'rollhook'

export async function validateApp(clonePath: string, logPath: string): Promise<AppConfig> {
  const log = (line: string) => appendFileSync(logPath, `${line}\n`)

  log('[validate] Validating rollhook.yaml')

  const rollhookYamlPath = join(clonePath, 'rollhook.yaml')
  if (!existsSync(rollhookYamlPath))
    throw new Error(`rollhook.yaml not found at ${rollhookYamlPath}`)

  const parsed = yaml.load(readFileSync(rollhookYamlPath, 'utf-8'))

  if (!Value.Check(AppConfigSchema, parsed)) {
    const errors = [...Value.Errors(AppConfigSchema, parsed)]
    throw new Error(`Invalid rollhook.yaml:\n${errors.map(e => `  ${e.path}: ${e.message}`).join('\n')}`)
  }

  const appConfig = parsed as AppConfig

  const composeFile = appConfig.compose_file ?? 'compose.yml'
  if (!existsSync(join(clonePath, composeFile)))
    throw new Error(`Compose file not found: ${composeFile}`)

  log(`[validate] OK — compose: ${composeFile}, steps: ${appConfig.steps.map(s => s.service).join(', ')}`)

  return appConfig
}
