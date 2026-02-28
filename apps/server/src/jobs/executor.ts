import type { JobResult, JobStatus } from 'rollhook'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { getJob, insertJob, updateJobDiscovery, updateJobStatus } from '@/db/jobs'
import { notify } from '@/jobs/notifier'
import { enqueue, setProcessor } from '@/jobs/queue'
import { discover } from '@/jobs/steps/discover'
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
  const log = (line: string) => appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)

  log(`[executor] Starting deployment: ${app} @ ${imageTag}`)
  updateJobStatus(jobId, 'running')

  let finalStatus: JobStatus = 'success'
  let finalError: string | undefined

  try {
    const { composePath, service, project } = await discover(imageTag, app, logPath)
    if (service !== app)
      throw new Error(`Discovered service '${service}' does not match requested app '${app}'`)
    updateJobDiscovery(jobId, composePath, service)
    validateCompose(composePath, imageTag, logPath)
    await pullImage(imageTag, logPath)
    await rolloutApp(composePath, service, project, imageTag, logPath)
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

export async function waitForJob(jobId: string, timeoutMs = 10 * 60 * 1000): Promise<JobResult> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const job = getJob(jobId)
    if (job && (job.status === 'success' || job.status === 'failed'))
      return job
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`)
}

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
  mkdirSync(LOGS_DIR, { recursive: true })
  appendFileSync(getLogPath(id), `[${now}] [queue] Deployment queued: ${app} @ ${imageTag}\n`)
  enqueue({ jobId: id, app, imageTag })

  return job
}
