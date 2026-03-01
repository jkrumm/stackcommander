import process from 'node:process'
import { Elysia } from 'elysia'
import { getZotPassword, ZOT_USER } from './config'

const ZOT_BASE = 'http://127.0.0.1:5000'

// Hop-by-hop headers are connection-specific and must not be forwarded
const HOP_BY_HOP = new Set([
  'authorization',
  'host',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
])

export function validateRegistryAuth(authHeader: string | null | undefined): boolean {
  const secret = process.env.ROLLHOOK_SECRET!
  if (!authHeader)
    return false

  if (authHeader.startsWith('Bearer '))
    return authHeader.slice(7) === secret

  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = atob(authHeader.slice(6))
      const colonIdx = decoded.indexOf(':')
      if (colonIdx === -1)
        return false
      // Accept any username — only the password (ROLLHOOK_SECRET) is validated
      return decoded.slice(colonIdx + 1) === secret
    }
    catch {
      return false
    }
  }

  return false
}

async function proxyToZot(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const zotUrl = `${ZOT_BASE}${url.pathname}${url.search}`

  const basicAuth = btoa(`${ZOT_USER}:${getZotPassword()}`)
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    if (HOP_BY_HOP.has(key.toLowerCase()))
      continue
    headers.set(key, value)
  }
  headers.set('Authorization', `Basic ${basicAuth}`)

  const hasBody = !['GET', 'HEAD'].includes(request.method) && request.body !== null
  // Buffer via arrayBuffer() — Bun's server-side ReadableStream cannot be piped
  // directly to fetch() as a streaming body. Buffering works for all OCI payloads
  // (manifests are <100KB; blob layers are chunked by Docker into manageable sizes).
  const body = hasBody ? await request.arrayBuffer() : undefined
  const zotResponse = await fetch(zotUrl, {
    method: request.method,
    headers,
    body,
  })

  const responseHeaders = new Headers()
  for (const [key, value] of zotResponse.headers.entries()) {
    if (['transfer-encoding', 'connection'].includes(key.toLowerCase()))
      continue
    // Rewrite absolute Location URLs from Zot (e.g. http://127.0.0.1:5000/v2/...)
    // to relative paths so Docker follows them through our proxy, not directly to Zot.
    if (key.toLowerCase() === 'location') {
      const rewritten = value.replace(/^https?:\/\/127\.0\.0\.1:\d+/, '')
      responseHeaders.set(key, rewritten || '/')
    }
    else {
      responseHeaders.set(key, value)
    }
  }

  return new Response(zotResponse.body, {
    status: zotResponse.status,
    headers: responseHeaders,
  })
}

function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      errors: [{ code: 'UNAUTHORIZED', message: 'authentication required', detail: null }],
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Basic realm="RollHook Registry"',
      },
    },
  )
}

async function handleRegistryRequest(request: Request): Promise<Response> {
  const authHeader = request.headers.get('Authorization')
  if (!validateRegistryAuth(authHeader))
    return unauthorizedResponse()
  return proxyToZot(request)
}

// Handles all OCI distribution spec routes under /v2.
// Docker clients send GET /v2/ first (discovery) — we return 401 with WWW-Authenticate
// so Docker knows to use Basic auth. Subsequent requests are proxied to Zot.
//
// Elysia 1.4 quirk: .all('/v2/*') matches nothing (wildcard broken for nested paths).
// Solution: use .all() for exact paths (/v2, /v2/) and per-method routes for wildcards.
// GET also handles HEAD automatically; OCI DELETE uses .delete() for safety.
const handler = ({ request }: { request: Request }) => handleRegistryRequest(request)
export const registryProxy = new Elysia()
  .all('/v2', handler)
  .all('/v2/', handler)
  .get('/v2/*', handler)
  .post('/v2/*', handler)
  .put('/v2/*', handler)
  .patch('/v2/*', handler)
  .delete('/v2/*', handler)
