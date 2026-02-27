import process from 'node:process'
import { app } from '@/app'
import { waitForQueueDrain } from '@/jobs/queue'
import { startShutdown } from '@/state'

const port = Number(process.env.PORT ?? 7700)
app.listen(port, () => {
  process.stdout.write(`RollHook running on http://localhost:${port}\n`)
})

// Graceful shutdown: return 503 from /health so Traefik deregisters us,
// drain the job queue so in-flight deployments complete cleanly, then exit.
process.on('SIGTERM', async () => {
  startShutdown()
  // Allow Traefik to observe the 503 and stop routing (healthcheck interval 1s + buffer)
  await new Promise(resolve => setTimeout(resolve, 3_000))
  // Wait for the current job to finish (up to 5 minutes)
  await waitForQueueDrain(5 * 60 * 1000)
  app.stop(true)
  process.exit(0)
})
