import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { deployApi } from '@/api/deploy'
import { healthApi } from '@/api/health'
import { jobsApi } from '@/api/jobs'
import { registryApi } from '@/api/registry'

export const app = new Elysia()
  .use(openapi({
    path: '/openapi',
    documentation: {
      info: { title: 'RollHook API', version: '0.1.0' },
      tags: [
        { name: 'Deploy', description: 'Trigger rolling deployments' },
        { name: 'Jobs', description: 'Job status and log streaming' },
        { name: 'Registry', description: 'App registry management' },
        { name: 'Health', description: 'Health check' },
      ],
    },
  }))
  .use(healthApi)
  .use(deployApi)
  .use(jobsApi)
  .use(registryApi)

export type App = typeof app
