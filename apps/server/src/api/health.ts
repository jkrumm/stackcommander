import process from 'node:process'
import { Elysia } from 'elysia'

export const healthApi = new Elysia()
  .get('/health', () => ({ status: 'ok', version: process.env.VERSION ?? 'dev' }), {
    detail: { summary: 'Health check', tags: ['Health'] },
  })
