import { Elysia } from 'elysia'

export const healthApi = new Elysia()
  .get('/health', () => ({ status: 'ok' }), {
    detail: { summary: 'Health check', tags: ['Health'] },
  })
