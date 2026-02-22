import { Elysia } from 'elysia'

const app = new Elysia()
  .get('/', () => ({ message: 'StackCommander API', status: 'ok' }))
  .get('/health', () => ({ status: 'ok' }))
  .listen(3001)

console.log(`Server running at http://${app.server?.hostname}:${app.server?.port}`)

export type App = typeof app
