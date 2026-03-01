import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { deployApi } from '@/api/deploy'
import { healthApi } from '@/api/health'
import { jobsApi } from '@/api/jobs'
import { registryProxy } from '@/registry/proxy'

const publicDir = join(import.meta.dir, '../public')
const assetsDir = resolve(publicDir, 'assets')

export const app = new Elysia()
  .use(openapi({
    path: '/openapi',
    documentation: {
      info: { title: 'RollHook API', version: '0.1.0' },
      tags: [
        { name: 'Deploy', description: 'Trigger rolling deployments' },
        { name: 'Jobs', description: 'Job status and log streaming' },
        { name: 'Health', description: 'Health check' },
      ],
    },
  }))
  .use(healthApi)
  .use(deployApi)
  .use(jobsApi)
  .use(registryProxy)
  // Hashed static assets (JS, CSS, fonts) — path traversal hardened
  .get('/assets/*', ({ params }) => {
    const requested = params['*'] ?? ''
    const filePath = resolve(assetsDir, requested)
    const withinAssets = filePath === assetsDir || filePath.startsWith(`${assetsDir}${sep}`)
    if (!withinAssets || !existsSync(filePath))
      return new Response('Not found', { status: 404 })
    return new Response(Bun.file(filePath))
  })
  // SPA fallback — all unmatched routes serve index.html
  .get('/*', () => {
    const indexPath = join(publicDir, 'index.html')
    if (!existsSync(indexPath)) {
      return new Response('Dashboard not built. Run: bun run build:dashboard', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
    return new Response(Bun.file(indexPath), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  })

export type App = typeof app
