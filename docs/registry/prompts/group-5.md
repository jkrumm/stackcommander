# Group 5: Registry Completeness & Full E2E Validation

## What You're Doing

Consolidation group. Complete the registry feature set, harden the implementation, and validate everything end-to-end. After this group, the registry is production-ready and the full E2E suite proves it.

Key additions:
- `triggered_by` field in jobs (tracks whether deploy was triggered by API or CI)
- Deploy endpoint aware of RollHook-hosted images (no discovery for same-host images)
- `ROLLHOOK_URL` env var for constructing canonical image tags
- Final comprehensive E2E validation of the complete registry + deploy flow

**There is no auto-deploy on push.** The deploy step remains explicit (`POST /deploy`). The GitHub Action (Group 7) will call both in sequence. This gives users full control and a clean conceptual model: push = store, deploy = roll out.

---

## Research & Exploration First

Before writing code:

1. Read `apps/server/src/api/deploy.ts` — understand current deploy endpoint
2. Read `apps/server/src/jobs/executor.ts` — understand `scheduleJob` and job structure
3. Read `apps/server/src/db/jobs.ts` — understand job schema
4. Read `apps/server/src/jobs/steps/pull.ts` — understand docker pull step
5. Read `e2e/tests/deploy.test.ts` — understand existing deploy E2E tests
6. Check `packages/rollhook/src/types.ts` — current `JobResult` and `JobStatus` types
7. Explore the full E2E test suite to understand coverage gaps: what's not yet tested for the registry flow?

---

## What to Implement

### 1. Add `triggered_by` to jobs

**DB** (`apps/server/src/db/client.ts`): Add `triggered_by TEXT NOT NULL DEFAULT 'api'` column to the `jobs` table. Greenfield — just add it to the `CREATE TABLE` statement directly.

**`apps/server/src/db/jobs.ts`**: Include `triggered_by` in insert and select.

**`packages/rollhook/src/types.ts`**: Add to `JobResult`:
```typescript
triggered_by: 'api' | 'ci'
```
Use `'ci'` when the GitHub Action triggers it (detectable via a request header or explicit field in the POST body).

**`apps/server/src/api/deploy.ts`**: Accept optional `triggered_by` in request body, default `'api'`.

### 2. Add `ROLLHOOK_URL` env var support

When a RollHook-hosted image is deployed, the canonical image tag is `<rollhook-url>/<app>:<tag>`. Add support for configuring the canonical hostname:

```typescript
// Optional env var: ROLLHOOK_URL
// e.g. https://rollhook.yourdomain.com
// Used to build canonical image tags shown in job history and deploy responses
// Falls back to the request's Host header if not set
```

Expose this in the `GET /deploy` response as `registry_url` (the push endpoint users should use).

### 3. Local image pull optimization (optional but nice)

When the `image_tag` in a deploy request matches an image in RollHook's own registry (`host` header matches `ROLLHOOK_URL` or is `localhost`), the `docker pull` step can pull from the local Zot registry directly (already on `127.0.0.1:5000`). The existing `pull.ts` step just calls `docker pull <image_tag>` — this works as-is since docker daemon can reach RollHook's public port.

If there's a simpler/faster way (e.g. skipping the public auth hop), implement it. Otherwise, leave as-is and note in learning docs.

### 4. Comprehensive E2E test: `e2e/tests/registry-deploy.test.ts`

This is the integration test that proves the full flow works:

```typescript
describe('registry + deploy integration', () => {
  it('push image to RollHook registry → explicit POST /deploy → container updated', async () => {
    // 1. docker push localhost:7700/rollhook-e2e-hello:v2
    // 2. POST /deploy with { image_tag: 'localhost:7700/rollhook-e2e-hello:v2' }
    // 3. pollJobUntilDone(jobId)
    // 4. Verify container serves v2 content
    // 5. Verify job has triggered_by: 'ci' (if triggered with ci header)
  })

  it('external registry image still deploys correctly', async () => {
    // Use a small public image (e.g. hello-world from Docker Hub) if available
    // OR: note that external registry path is tested in existing deploy.test.ts
  })

  it('mixed usage: some apps on RollHook registry, some on external', async () => {
    // Deploy app-a from RollHook registry
    // Deploy app-b using explicit image_tag (same compose stack)
    // Both succeed
  })
})
```

### 5. Hardening pass

After reviewing the complete implementation so far, identify and fix:
- Any missing error handling in the proxy (what happens if Zot is slow to respond?)
- Race condition: what if a deploy is triggered while the same image is still being pushed? (FIFO queue handles this — document it)
- Security: does the proxy correctly prevent clients from accessing Zot's internal management endpoints if any exist?
- Log quality: are Zot logs forwarded cleanly? Is there noise to filter?

---

## E2E Strategy

**Run full E2E for this group** — all test files must pass:

```bash
bun run test:e2e
```

This is the "registry done" checkpoint. If any test fails, fix it before proceeding to dashboard (Group 6) and action (Group 7).

---

## Updated Env Vars Table

| Var | Required | Purpose |
|-|-|-|
| `ROLLHOOK_SECRET` | yes | All auth: registry, deploy, dashboard |
| `ROLLHOOK_URL` | no | Canonical registry URL for image tag construction |
| `REGISTRY_STORAGE_PATH` | no | Zot storage root (default: `/app/data/registry`) |
| `DOCKER_HOST` | no | Docker socket (default: local socket) |
| `PUSHOVER_USER_KEY` | no | Pushover notifications |
| `PUSHOVER_APP_TOKEN` | no | Pushover notifications |
| `NOTIFICATION_WEBHOOK_URL` | no | POST job result to URL on completion |

Update `CLAUDE.md` with this table.

---

## Verification

```bash
bun run typecheck && bun run lint && bun run test
bun run test:e2e
```

E2E must be green before signaling completion.

---

## Commit

```bash
git commit -m "feat(registry): add triggered_by, ROLLHOOK_URL support, and integration E2E tests"
```

---

## Done

Write learning notes to `docs/registry/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 5
```
