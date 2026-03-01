import type { JobResult } from 'rollhook'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(DIR, '..')
const OUTPUT = join(ROOT, 'apps/dashboard/src/demo/data.json')

const BASE_URL = 'http://localhost:7700'
const TOKEN = process.env.ROLLHOOK_SECRET ?? 'e2e-secret-token'

async function fetchLogs(jobId: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/jobs/${jobId}/logs`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok || !res.body)
    return []
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const lines: string[] = []
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.replace(/^data: /, '').trim()
      if (line)
        lines.push(line)
    }
  }
  // Flush decoder and emit any trailing buffered event not terminated by \n\n
  buffer += decoder.decode()
  const tail = buffer.replace(/^data: /, '').trim()
  if (tail)
    lines.push(tail)
  return lines
}

async function main() {
  const res = await fetch(`${BASE_URL}/jobs?limit=50`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok)
    throw new Error(`Failed to fetch jobs: ${res.status}`)
  const jobs = await res.json() as JobResult[]

  const logs: Record<string, string[]> = {}
  for (const job of jobs) {
    if (job.status === 'success' || job.status === 'failed') {
      logs[job.id] = await fetchLogs(job.id)
    }
  }

  const data = {
    generated: new Date().toISOString(),
    jobs,
    logs,
  }
  writeFileSync(OUTPUT, `${JSON.stringify(data, null, 2)}\n`)
  console.warn(`Exported ${jobs.length} jobs to ${OUTPUT}`)
}

main().catch((err) => {
  console.error('demo export failed:', err)
  process.exit(1)
})
