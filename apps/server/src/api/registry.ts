import { Elysia, t } from 'elysia'
import { loadConfig, saveConfig } from '@/config/loader'
import { listJobs } from '@/db/jobs'
import { requireRole } from '@/middleware/auth'

export const registryApi = new Elysia({ prefix: '/registry' })
  .use(requireRole('admin'))
  .get('/', () => {
    const config = loadConfig()
    return config.apps.map((appConfig) => {
      const [lastDeploy] = listJobs({ app: appConfig.name, limit: 1 })
      return {
        name: appConfig.name,
        compose_path: appConfig.compose_path,
        steps: appConfig.steps,
        last_deploy: lastDeploy ?? null,
      }
    })
  }, {
    detail: { tags: ['Registry'], summary: 'List registered apps with last deploy info' },
  })
  .patch('/:app', ({ params, body, set }) => {
    const config = loadConfig()
    const appConfig = config.apps.find(a => a.name === params.app)
    if (!appConfig) {
      set.status = 404
      return { message: `App "${params.app}" not found` }
    }

    if (body.compose_path)
      appConfig.compose_path = body.compose_path

    saveConfig()

    return { name: appConfig.name, compose_path: appConfig.compose_path }
  }, {
    params: t.Object({ app: t.String() }),
    body: t.Object({
      compose_path: t.Optional(t.String()),
    }),
    detail: { tags: ['Registry'], summary: 'Update app config' },
  })
