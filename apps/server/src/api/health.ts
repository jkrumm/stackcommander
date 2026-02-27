import process from 'node:process'
import { Elysia } from 'elysia'
import { isShuttingDown } from '@/state'

export const healthApi = new Elysia()
  .get('/health', ({ set }) => {
    if (isShuttingDown()) {
      set.status = 503
      return { status: 'shutting_down', version: process.env.VERSION ?? 'dev' }
    }
    return { status: 'ok', version: process.env.VERSION ?? 'dev' }
  }, {
    detail: { summary: 'Health check', tags: ['Health'] },
  })
