/**
 * Mock OIDC server for E2E tests.
 *
 * Serves a fake GitHub Actions OIDC provider:
 *   GET  /.well-known/openid-configuration  — OIDC discovery document
 *   GET  /.well-known/jwks                  — public key set (JWK format)
 *   POST /token                             — issue a signed test JWT
 *
 * The issuer URL is http://mock-oidc:8080 (Docker service name).
 * RollHook is configured with ROLLHOOK_OIDC_ISSUER=http://mock-oidc:8080.
 * E2E tests call POST http://localhost:8080/token to get tokens.
 */
import process from 'node:process'

const PORT = Number.parseInt(process.env.PORT ?? '8080')
// The issuer must match how RollHook reaches this server inside Docker network.
const ISSUER = process.env.ISSUER ?? 'http://mock-oidc:8080'
const KID = 'e2e-test-key-1'

interface TokenRequest {
  repository: string
  ref: string
  actor?: string
  aud?: string
  exp_offset?: number
}

function b64url(data: BufferSource | string): string {
  const bytes
    = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : new Uint8Array(data instanceof ArrayBuffer ? data : (data as ArrayBufferView).buffer)
  let b64 = ''
  for (const byte of bytes)
    b64 += String.fromCharCode(byte)
  return btoa(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function startServer(): Promise<void> {
  // Generate RSA-2048 key pair (WebCrypto API, available in Bun).
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as Record<string, unknown>
  publicKeyJwk.kid = KID
  publicKeyJwk.use = 'sig'
  publicKeyJwk.alg = 'RS256'

  async function signJWT(payload: Record<string, unknown>): Promise<string> {
    const header = { alg: 'RS256', typ: 'JWT', kid: KID }
    const encoded = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      new TextEncoder().encode(encoded),
    )
    return `${encoded}.${b64url(sig)}`
  }

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const { pathname } = new URL(req.url)

      if (pathname === '/.well-known/openid-configuration') {
        return Response.json({
          issuer: ISSUER,
          jwks_uri: `${ISSUER}/.well-known/jwks`,
          // Minimal fields — go-oidc only requires issuer and jwks_uri.
        })
      }

      if (pathname === '/.well-known/jwks') {
        return Response.json({ keys: [publicKeyJwk] })
      }

      if (pathname === '/token' && req.method === 'POST') {
        const body = await req.json() as TokenRequest
        if (!body.repository || !body.ref)
          return Response.json({ error: 'repository and ref are required' }, { status: 400 })

        const now = Math.floor(Date.now() / 1000)
        const exp = now + (body.exp_offset ?? 3600)

        const token = await signJWT({
          iss: ISSUER,
          sub: `repo:${body.repository}:ref:${body.ref}`,
          aud: body.aud ?? ISSUER,
          ref: body.ref,
          repository: body.repository,
          repository_owner: body.repository.split('/')[0],
          actor: body.actor ?? 'test-actor',
          iat: now,
          nbf: now,
          exp,
        })

        return Response.json({ token })
      }

      return new Response('not found', { status: 404 })
    },
  })

  console.warn(`Mock OIDC server running — issuer: ${ISSUER}`)
}

startServer().catch(console.error)
