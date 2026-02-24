export interface QueuedJob {
  jobId: string
  app: string
  imageTag: string
}

type JobProcessor = (job: QueuedJob) => Promise<void>

let processor: JobProcessor | null = null
const queue: QueuedJob[] = []
let running = false

export function setProcessor(fn: JobProcessor): void {
  processor = fn
}

export function enqueue(job: QueuedJob): void {
  queue.push(job)
  if (!running)
    drain()
}

async function drain(): Promise<void> {
  if (!processor)
    throw new Error('No job processor registered')

  running = true
  while (queue.length > 0) {
    const job = queue.shift()!
    try {
      await processor(job)
    }
    catch (err) {
      console.error(`[queue] Unhandled error for job ${job.jobId}:`, err)
    }
  }
  running = false
}
