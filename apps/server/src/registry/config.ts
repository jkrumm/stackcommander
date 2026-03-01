import process from 'node:process'

// Fixed internal username — never exposed to users
export const ZOT_USER = 'rollhook'

// Zot's internal password IS the ROLLHOOK_SECRET.
// Deterministic and stateless: same password every restart, no in-memory state.
// Security is fine: Zot binds to 127.0.0.1 (loopback only).
export function getZotPassword(): string {
  return process.env.ROLLHOOK_SECRET!
}

export function generateZotConfig(opts: {
  storageRoot: string
  htpasswdPath: string
  port: number
}): string {
  return JSON.stringify(
    {
      distSpecVersion: '1.1.1',
      http: {
        address: '127.0.0.1',
        port: String(opts.port),
        auth: {
          htpasswd: { path: opts.htpasswdPath },
        },
        compat: ['docker2s2'],
      },
      storage: {
        rootDirectory: opts.storageRoot,
      },
      log: {
        level: 'info',
      },
    },
    null,
    2,
  )
}

// Generates an htpasswd line using bcrypt (Bun built-in, no extra deps).
// Zot's Go bcrypt library accepts $2b$ prefix from Bun's output.
export async function generateHtpasswd(): Promise<string> {
  const hash = await Bun.password.hash(getZotPassword(), { algorithm: 'bcrypt', cost: 12 })
  return `${ZOT_USER}:${hash}\n`
}
