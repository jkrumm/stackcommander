# Group 2: Zot Binary & Process Manager

## What You're Doing

Bundle the Zot OCI registry binary into the Docker image and start it automatically as a subprocess on every RollHook startup. Zot runs on `127.0.0.1:5000` (loopback only). RollHook generates all Zot configuration internally — users never touch Zot config. All Zot data goes into `/app/data/registry/` (the bound volume).

The registry is not optional. It always starts.

---

## Research & Exploration First

Before writing code:

1. Read `apps/server/Dockerfile` — understand the existing tool-downloader pattern (docker CLI already downloaded this way with SHA256 verification + TARGETARCH)
2. Read `apps/server/server.ts` — understand startup sequence for wiring in the manager
3. Read `apps/server/src/app.ts` — understand plugin composition
4. **Research Zot releases:** Fetch the latest stable Zot release from GitHub releases. Look up the exact version, download URL format, and SHA256 hashes for `linux-amd64` and `linux-arm64`. Use WebFetch or WebSearch.
   - Start at: `https://github.com/project-zot/zot/releases/latest`
   - Zot release filename format: `zot-linux-amd64`, `zot-linux-arm64`
5. **Research Zot configuration:** Read Zot's admin guide to understand the minimal config format (JSON or YAML) and available auth options. Use WebFetch:
   - `https://zotregistry.dev/v2.1.0/admin-guide/admin-configuration/`
   - Focus: HTTP config, storage config, auth config (simplest single-user option)

---

## What to Implement

### 1. Zot binary in `apps/server/Dockerfile`

Add to the `tool-downloader` stage, following the exact same pattern as the docker CLI download (SHA256 verified, TARGETARCH-aware):

```dockerfile
ARG ZOT_VERSION=<look up actual latest stable>
ARG ZOT_AMD64_SHA256=<sha256 of zot-linux-amd64>
ARG ZOT_ARM64_SHA256=<sha256 of zot-linux-arm64>

# Download Zot binary for the target architecture
RUN ZOT_ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") \
  && ZOT_SHA=$([ "$TARGETARCH" = "arm64" ] && echo "${ZOT_ARM64_SHA256}" || echo "${ZOT_AMD64_SHA256}") \
  && curl -fsSL \
     "https://github.com/project-zot/zot/releases/download/v${ZOT_VERSION}/zot-linux-${ZOT_ARCH}" \
     -o /usr/local/bin/zot \
  && echo "${ZOT_SHA}  /usr/local/bin/zot" | sha256sum -c - \
  && chmod +x /usr/local/bin/zot
```

Then in the runner stage:
```dockerfile
COPY --from=tool-downloader /usr/local/bin/zot /usr/local/bin/zot
```

**Use real version + SHA256 values.** Do not use placeholders. Verify with:
```bash
curl -fsSL https://github.com/project-zot/zot/releases/download/vX.Y.Z/zot-linux-amd64 | sha256sum
```

### 2. Create `apps/server/src/registry/config.ts`

After reading Zot's config format, implement config generation:

```typescript
import process from 'node:process'

// Fixed internal username — never exposed to users
export const ZOT_USER = 'rollhook'

// Zot's internal password IS the ROLLHOOK_SECRET.
// No random generation needed — this keeps things simple and predictable:
// - Same password every restart (deterministic)
// - No in-memory state to track
// - Security is fine: Zot binds to 127.0.0.1 (loopback only), never reachable
//   from outside the container. The bcrypt hash in .htpasswd is one-way.
export function getZotPassword(): string {
  return process.env.ROLLHOOK_SECRET!
}

export function generateZotConfig(opts: {
  storageRoot: string  // /app/data/registry
  htpasswdPath: string // /app/data/registry/.htpasswd
  port: number         // 5000
}): string {
  // Return Zot config as JSON string (or YAML — whichever is simpler)
  // Minimal: http address (127.0.0.1), storage rootDir, auth htpasswd
}

export async function generateHtpasswd(): Promise<string> {
  // Hash ROLLHOOK_SECRET with bcrypt for htpasswd format: "rollhook:$2b$12$..."
  // Use bcryptjs. Check workspace deps first; add if needed:
  //   bun add bcryptjs @types/bcryptjs --cwd apps/server
  // Alternative: if Zot supports bearer token / API key auth that avoids
  // bcrypt entirely, use that instead. Research this first.
}
```

**Research Zot auth options.** Use WebFetch on `https://zotregistry.dev/v2.1.0/admin-guide/admin-configuration/` to understand available auth modes. If Zot supports a simpler single-credential option that avoids bcrypt, use it — document the choice in learning notes.

### 3. Create `apps/server/src/registry/manager.ts`

```typescript
import { ZOT_USER, getZotPassword } from './config'

export interface RegistryManager {
  start(): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean
  // Returns { user: 'rollhook', password: ROLLHOOK_SECRET }
  // No random state — same answer on every call, every restart
  getInternalCredentials(): { user: string; password: string }
}

export function createRegistryManager(): RegistryManager {
  // start():
  //   1. Write generateZotConfig() to /app/data/registry/config.json
  //   2. Write generateHtpasswd() to /app/data/registry/.htpasswd
  //   3. Bun.spawn(['zot', 'serve', configPath])
  //   4. Poll http://127.0.0.1:5000/v2/ until 200 or 401 (both = Zot is up)
  //   5. Timeout after 10s with clear error
  // stop(): subprocess.kill() — SIGTERM
  // getInternalCredentials(): { user: ZOT_USER, password: getZotPassword() }
  // Forward stdout/stderr with [zot] prefix
  // If Zot crashes: log error, do not auto-restart
}
```

### 4. Wire into `apps/server/server.ts`

```typescript
import { createRegistryManager } from '@/registry/manager'

const registryManager = createRegistryManager()
await registryManager.start()

// Export for use by proxy routes in Group 3:
export { registryManager }

// In SIGTERM handler (find existing shutdown code):
await registryManager.stop()
```

### 5. Storage layout in `/app/data/`

```
/app/data/
  rollhook.db           — SQLite (existing)
  registry/
    config.json          — Zot config (generated at startup)
    .htpasswd            — Zot auth (generated at startup)
    blobs/               — OCI blob storage (managed by Zot)
    index/               — Zot index storage (managed by Zot)
```

All of `/app/data/` is the bound volume. One volume = complete backup.

### 6. Unit test: `apps/server/src/__tests__/registry-config.test.ts`

Test config generation functions:
- `getZotPassword()` returns `ROLLHOOK_SECRET` (set via preload in tests)
- `generateZotConfig()` returns valid JSON/YAML with correct address/port
- Config includes the correct storage root path
- `generateHtpasswd()` returns bcrypt-hashed line in correct htpasswd format

Do not test actual Zot subprocess start (that's E2E territory).

---

## E2E Strategy

**Skip E2E for this group.** Zot starts inside the container but the `/v2/*` proxy doesn't exist yet, so existing E2E deploy tests are unaffected. The E2E compose still has `registry:2` (removed in Group 3). Run only unit tests.

---

## Verification

```bash
bun run typecheck && bun run lint && bun run test
```

The new `registry-config.test.ts` tests must pass.

---

## Commit

```bash
git commit -m "feat(registry): add Zot binary to Docker image and process manager"
```

---

## Done

Write learning notes to `docs/registry/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 2
```
