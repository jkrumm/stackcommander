import process from 'node:process'

const VERSION = process.env.BUILD_VERSION ?? 'unknown'
let isShuttingDown = false

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === '/health')
      return new Response(isShuttingDown ? 'shutting down' : 'ok', { status: isShuttingDown ? 503 : 200 })
    if (pathname === '/version')
      return Response.json({ version: VERSION, pid: process.pid })
    return new Response('not found', { status: 404 })
  },
})

// Graceful shutdown: return 503 from /health so Traefik deregisters us
// before we stop accepting connections, preventing 502s during rolling updates
process.on('SIGTERM', async () => {
  isShuttingDown = true
  // Wait for Traefik to deregister (healthcheck interval 1s + buffer)
  await new Promise(resolve => setTimeout(resolve, 3000))
  await server.stop(true)
  process.exit(0)
})
