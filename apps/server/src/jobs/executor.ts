import type { JobResult, JobStatus } from 'rollhook'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { loadConfig } from '@/config/loader'
import { getJob, insertJob, updateJobStatus } from '@/db/jobs'
import { notify } from '@/jobs/notifier'
import { enqueue, setProcessor } from '@/jobs/queue'
import { pullImage } from '@/jobs/steps/pull'
import { rolloutApp } from '@/jobs/steps/rollout'
import { validateCompose } from '@/jobs/steps/validate'

const LOGS_DIR = join(process.cwd(), 'data', 'logs')

export function getLogPath(jobId: string): string {
  return join(LOGS_DIR, `${jobId}.log`)
}

async function executeJob(job: { jobId: string, app: string, imageTag: string }): Promise<void> {
  const { jobId, app, imageTag } = job
  const logPath = getLogPath(jobId)
  const log = (line: string) => appendFileSync(logPath, `${line}\n`)

  log(`[executor] Starting deployment: ${app} @ ${imageTag}`)
  updateJobStatus(jobId, 'running')

  let finalStatus: JobStatus = 'success'
  let finalError: string | undefined

  try {
    const config = loadConfig()
    const appConfig = config.apps.find(a => a.name === app)
    if (!appConfig)
      throw new Error(`App "${app}" not found in rollhook.config.yaml`)

    validateCompose(appConfig.compose_path, logPath)
    await pullImage(imageTag, logPath)
    await rolloutApp(appConfig.compose_path, appConfig.steps, imageTag, logPath)
    log(`[executor] Deployment successful: ${app}`)
  }
  catch (err) {
    finalStatus = 'failed'
    finalError = err instanceof Error ? err.message : String(err)
    log(`[executor] ERROR: ${finalError}`)
  }

  updateJobStatus(jobId, finalStatus, finalError)

  const jobRecord = getJob(jobId)
  if (jobRecord)
    await notify(jobRecord, logPath)
}

setProcessor(executeJob)

export function scheduleJob(app: string, imageTag: string): JobResult {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const job: JobResult = {
    id,
    app,
    image_tag: imageTag,
    status: 'queued',
    created_at: now,
    updated_at: now,
  }

  insertJob(job)
  enqueue({ jobId: id, app, imageTag })

  return job
}
