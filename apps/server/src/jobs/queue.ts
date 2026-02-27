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

export async function waitForQueueDrain(timeoutMs = 5 * 60 * 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!running && queue.length === 0)
      return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
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
