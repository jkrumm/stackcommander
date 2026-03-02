import type { JobResult } from '@rollhook/ui'
import rawData from '../demo/data.json'

export interface DemoData {
  generated: string
  jobs: JobResult[]
  logs: Record<string, string[]>
}

export const demoData = rawData as DemoData
