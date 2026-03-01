# Group 3: OCI Reverse Proxy

## What You're Doing

Add `/v2/*` routes to the Elysia app that act as an authenticated reverse proxy to Zot on `127.0.0.1:5000`. Users push/pull using `ROLLHOOK_SECRET`. RollHook translates to internal Zot credentials.

This group also migrates the E2E test infrastructure from the external `registry:2` service to RollHook's embedded registry. After this group, `registry:2` is gone from the codebase forever.

---

## Research & Exploration First

Before writing code:

1. Read `apps/server/src/middleware/auth.ts` — understand current auth plugin, how `requireRole` works
2. Read `apps/server/src/app.ts` — understand plugin/route composition patterns
3. Read `apps/server/src/registry/manager.ts` (from Group 2) — understand `getInternalCredentials()`
4. Read `apps/server/server.ts` — understand how to access the manager instance
5. Read `e2e/compose.e2e.yml` — understand the registry:2 service you'll remove
6. Read `e2e/setup/global.ts` — find where images are pushed to registry:2 (these need to push to RollHook instead)
7. Read `e2e/setup/fixtures.ts` — find registry URL constants
8. **Research OCI Distribution Spec auth flow:** The Docker client sends `GET /v2/` first, expects a `401` with a `WWW-Authenticate` header, then retries with `Authorization: Basic <b64>`. Both Bearer and Basic auth from the client need to be accepted.
9. **Research Bun's fetch streaming:** Verify how to proxy a streaming body (blob uploads) through `fetch()` without buffering in memory. Key: `duplex: 'half'` option on request + pass `response.body` (ReadableStream) directly to response.

---

## What to Implement

### 1. Create `apps/server/src/registry/proxy.ts`

The proxy route handler. Registered at `/v2` prefix in the Elysia app.

**Auth rules:**
- `GET /v2/` without auth → `401` with `WWW-Authenticate` header (Docker protocol requirement)
- All other requests: validate `ROLLHOOK_SECRET` from either `Authorization: Bearer <secret>` or `Authorization: Basic <b64(:secret)>` (any username)
- On valid auth: forward request to Zot with `Authorization: Basic <b64(user:internalPassword)>`

**Proxy behavior:**
- Forward all HTTP methods: GET, HEAD, POST, PUT, PATCH, DELETE
- Preserve path and query string
- Stream request body to Zot (never buffer — blobs can be large)
- Stream Zot's response body back to client
- Forward relevant headers: `Content-Type`, `Content-Length`, `Docker-Content-Digest`, `Docker-Upload-UUID`, `Location`, all `Docker-*` headers
- Strip hop-by-hop headers: `Authorization`, `Host`, `Transfer-Encoding`, `Connection`

**Public repo exception (wired in Group 4):** For now, all requests require auth. The public repo bypass is added in Group 4 when the `registry_repos` table exists.

### 2. Register in `apps/server/src/app.ts`

```typescript
import { createRegistryProxy } from '@/registry/proxy'
// registryManager exported from server.ts or as module singleton

app.use(createRegistryProxy(registryManager))
```

The proxy is always registered (registry is always on).

### 3. Migrate E2E infrastructure

**`e2e/compose.e2e.yml`:**
- Remove the `registry` / `registry:2` service entirely
- Remove port `5001` mapping
- No other changes needed — RollHook's embedded Zot handles registry duties

**`e2e/setup/global.ts`:**
- Update all `localhost:5001` references to `localhost:7700` (RollHook proxy)
- The `docker login` step: login to `localhost:7700` with username `rollhook` and password from `ROLLHOOK_SECRET`
- The image push steps: push to `localhost:7700/rollhook-e2e-hello:v1` etc. instead of `localhost:5001/...`

**`e2e/setup/fixtures.ts`:**
- Update `REGISTRY_URL` constant from `localhost:5001` to `localhost:7700`
- Update any `REGISTRY_USER`/`REGISTRY_PASSWORD` constants to use the single `ROLLHOOK_SECRET`

**`e2e/tests/`:** Scan all test files for `5001` or `registry:2` references and update them.

**`examples/bun-hello-world/` compose files:**
The hello-world image reference in `compose.yml` uses `image: ${IMAGE_TAG:-localhost:5001/...}`. Update the default tag to use `localhost:7700` or simply remove the default (CI sets it explicitly).

### 4. Unit test: auth translation logic

Add tests to `apps/server/src/__tests__/registry-proxy.test.ts`:
- `validateSecret(undefined)` → false
- `validateSecret('Bearer correctsecret')` → true
- `validateSecret('Bearer wrongsecret')` → false
- `validateSecret('Basic ' + btoa('anyuser:correctsecret'))` → true
- `validateSecret('Basic ' + btoa('anyuser:wrongsecret'))` → false
- `GET /v2/` without auth → 401 with `WWW-Authenticate` header present

Use `app.handle(new Request(...))` pattern from existing auth tests.

---

## E2E Strategy

**Run full E2E for this group** — this is the critical migration point.

After completing the implementation:

```bash
bun run test:e2e
```

**All existing tests must pass:**
- `auth.test.ts` — token validation unchanged
- `deploy.test.ts` — deploy flow now pushes to RollHook registry, still deploys
- `failure.test.ts` — failure cases unchanged
- `health.test.ts` — health endpoint unchanged
- `jobs.test.ts` — job history unchanged
- `queue.test.ts` — queue behavior unchanged
- `zero-downtime.test.ts` — rolling deploy unchanged

If any test fails due to the registry migration (wrong URL, auth format, etc.), fix it before signaling completion.

**New smoke test** — also add `e2e/tests/registry-proxy.test.ts`:
```typescript
describe('registry proxy', () => {
  it('GET /v2/ without auth returns 401 with WWW-Authenticate header')
  it('GET /v2/ with valid ROLLHOOK_SECRET returns 200')
  it('GET /v2/ with wrong secret returns 401')
  // docker login/push/pull are validated implicitly by the E2E setup
  // (global.ts pushes hello-world images to localhost:7700)
})
```

---

## Verification

```bash
bun run typecheck && bun run lint && bun run test
bun run test:e2e
```

No `registry:2` or `5001` references should remain in the codebase (except docs).

---

## Commit

```bash
git commit -m "feat(registry): add OCI proxy, migrate E2E from registry:2 to embedded Zot"
```

---

## Done

Write learning notes to `docs/registry/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 3
```
