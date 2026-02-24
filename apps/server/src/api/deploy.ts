import { Elysia, t } from 'elysia'
import { loadConfig } from '@/config/loader'
import { scheduleJob } from '@/jobs/executor'
import { requireRole } from '@/middleware/auth'

export const deployApi = new Elysia({ prefix: '/deploy' })
  .use(requireRole('webhook'))
  .post('/:app', ({ params, body, set }) => {
    const config = loadConfig()
    const appConfig = config.apps.find(a => a.name === params.app)
    if (!appConfig) {
      set.status = 404
      return { message: `App "${params.app}" not found` }
    }

    const job = scheduleJob(params.app, body.image_tag)
    return { job_id: job.id, app: job.app, status: job.status }
  }, {
    params: t.Object({ app: t.String() }),
    body: t.Object({ image_tag: t.String() }),
    detail: { tags: ['Deploy'], summary: 'Trigger rolling deployment for an app' },
  })
