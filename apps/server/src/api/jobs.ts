import { createReadStream, existsSync } from 'node:fs'
import { Elysia, t } from 'elysia'
import { getJob, listJobs } from '@/db/jobs'
import { getLogPath } from '@/jobs/executor'
import { requireRole } from '@/middleware/auth'

const JobStatusSchema = t.Union([
  t.Literal('queued'),
  t.Literal('running'),
  t.Literal('success'),
  t.Literal('failed'),
])

export const jobsApi = new Elysia({ prefix: '/jobs' })
  .use(requireRole('admin'))
  .get('/:id', ({ params, set }) => {
    const job = getJob(params.id)
    if (!job) {
      set.status = 404
      return { message: `Job "${params.id}" not found` }
    }
    return job
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Jobs'], summary: 'Get job status' },
  })
  .get('/:id/logs', ({ params, set }) => {
    const logPath = getLogPath(params.id)
    if (!existsSync(logPath)) {
      set.status = 404
      return { message: `Logs not found for job "${params.id}"` }
    }

    const stream = createReadStream(logPath, { encoding: 'utf-8' })

    return new Response(
      new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => {
            const lines = String(chunk).split('\n')
            for (const line of lines) {
              if (line)
                controller.enqueue(`data: ${line}\n\n`)
            }
          })
          stream.on('end', () => controller.close())
          stream.on('error', err => controller.error(err))
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      },
    )
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Jobs'], summary: 'Stream job logs via SSE' },
  })
  .get('/', ({ query }) => {
    return listJobs({
      app: query.app,
      status: query.status,
      limit: query.limit ? Number(query.limit) : 50,
    })
  }, {
    query: t.Object({
      app: t.Optional(t.String()),
      status: t.Optional(JobStatusSchema),
      limit: t.Optional(t.String()),
    }),
    detail: { tags: ['Jobs'], summary: 'List jobs with optional filters' },
  })
