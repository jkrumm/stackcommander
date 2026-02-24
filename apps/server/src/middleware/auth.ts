import process from 'node:process'
import { Elysia } from 'elysia'

export type Role = 'admin' | 'webhook'

const ADMIN_TOKEN = process.env.ADMIN_TOKEN
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN

if (!ADMIN_TOKEN || !WEBHOOK_TOKEN) {
  throw new Error('ADMIN_TOKEN and WEBHOOK_TOKEN environment variables are required')
}

export function requireRole(role: Role) {
  return new Elysia({ name: `auth-${role}` })
    .onBeforeHandle({ as: 'scoped' }, ({ headers, set }) => {
      const authHeader = headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401
        return { message: 'Missing or invalid Authorization header' }
      }

      const token = authHeader.slice(7)

      if (role === 'admin' && token !== ADMIN_TOKEN) {
        set.status = 403
        return { message: 'Admin token required' }
      }

      if (role === 'webhook' && token !== ADMIN_TOKEN && token !== WEBHOOK_TOKEN) {
        set.status = 403
        return { message: 'Valid token required' }
      }
    })
}
