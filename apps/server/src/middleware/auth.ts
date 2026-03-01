import process from 'node:process'
import { Elysia } from 'elysia'

export type Role = 'admin' | 'webhook'

const ROLLHOOK_SECRET = process.env.ROLLHOOK_SECRET

if (!ROLLHOOK_SECRET) {
  throw new Error('ROLLHOOK_SECRET environment variable is required')
}

// No `name` on the Elysia instance to prevent plugin deduplication: Elysia
// deduplicates named plugins globally, so using requireRole('webhook') in both
// deployApi and jobsApi would silently skip the second registration.
// `{ as: 'local' }` keeps the hook scoped to THIS instance only — no upward
// propagation. Routes MUST be chained onto the requireRole(...) return value
// (not onto a parent after .use()) so the hook and routes share the same instance.
export function requireRole(_role: Role) {
  return new Elysia()
    .onBeforeHandle({ as: 'local' }, ({ headers, set }) => {
      const authHeader = headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401
        return { message: 'Missing or invalid Authorization header' }
      }

      const token = authHeader.slice(7)

      if (token !== ROLLHOOK_SECRET) {
        set.status = 403
        return { message: 'Valid token required' }
      }
    })
}
