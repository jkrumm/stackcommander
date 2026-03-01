# Registry Implementation — Task Checklist

Legend: ⬜ pending | 🔄 in-progress | ✅ complete | 🚫 blocked

E2E column: ✓ run E2E | – skip E2E | ⚠ E2E migration required

---

## Group 1: Foundation — Secret Consolidation
**Status:** ⬜ pending | **E2E:** ✓ run (rename affects fixtures)
**Goal:** Single `ROLLHOOK_SECRET` replaces `ADMIN_TOKEN` + `WEBHOOK_TOKEN`. Startup validation (min 7 chars).

- [ ] 1.1 Update `auth.ts`: `ROLLHOOK_SECRET` grants all access
- [ ] 1.2 Update `server.ts`: startup validation (missing or < 7 chars → exit 1)
- [ ] 1.3 Update `__tests__/preload.ts` + `auth.test.ts`
- [ ] 1.4 Update `e2e/setup/fixtures.ts` + `e2e/compose.e2e.yml` + `e2e/setup/global.ts`
- [ ] 1.5 Update `examples/**/*.yml`
- [ ] 1.6 Update `CLAUDE.md` env var table
- [ ] 1.7 Verify: zero grep hits for `ADMIN_TOKEN`/`WEBHOOK_TOKEN`; all unit + E2E tests pass

**Success:** `bun run test && bun run test:e2e` pass. No `ADMIN_TOKEN`/`WEBHOOK_TOKEN` in non-doc files.

---

## Group 2: Zot Binary & Process Manager
**Status:** ⬜ pending | **E2E:** – skip (proxy doesn't exist yet)
**Goal:** Zot binary bundled in Docker image. Starts automatically on every RollHook startup. All data in `/app/data/`.

- [ ] 2.1 Research actual latest Zot release + SHA256 hashes
- [ ] 2.2 Add Zot binary download to `Dockerfile` (TARGETARCH-aware, SHA256 verified)
- [ ] 2.3 Create `src/registry/config.ts`: config generation + internal password generation
- [ ] 2.4 Create `src/registry/manager.ts`: spawn Zot, health poll, log forwarding, graceful stop
- [ ] 2.5 Wire manager into `server.ts`: start before listen, stop on SIGTERM
- [ ] 2.6 Unit test: `__tests__/registry-config.test.ts`

**Success:** `bun run test` passes. Docker image builds with Zot binary included.

---

## Group 3: OCI Reverse Proxy
**Status:** ⬜ pending | **E2E:** ⚠ required (E2E migrated away from registry:2)
**Goal:** `/v2/*` proxy in Elysia. Auth: ROLLHOOK_SECRET → internal Zot credentials. Remove `registry:2` from E2E forever.

- [ ] 3.1 Create `src/registry/proxy.ts`: full OCI proxy (all HTTP methods, streaming)
- [ ] 3.2 Auth: accept Bearer + Basic, translate to Zot internal credentials
- [ ] 3.3 `GET /v2/` without auth → 401 with `WWW-Authenticate` header
- [ ] 3.4 Register proxy in `src/app.ts`
- [ ] 3.5 Remove `registry:2` service from `e2e/compose.e2e.yml`
- [ ] 3.6 Update `e2e/setup/global.ts` + `fixtures.ts`: push to `localhost:7700` instead of `localhost:5001`
- [ ] 3.7 Unit test: `__tests__/registry-proxy.test.ts` (auth validation cases)
- [ ] 3.8 New E2E: `e2e/tests/registry-proxy.test.ts` (basic 401/200 checks)
- [ ] 3.9 All existing E2E tests still pass

**Success:** `bun run test && bun run test:e2e` pass. No `5001` or `registry:2` in codebase.

---

## Group 4: Registry API & Visibility
**Status:** ⬜ pending | **E2E:** ✓ run + new registry.test.ts
**Goal:** API routes for image listing, tag listing, visibility toggle, image/tag deletion. Public repo bypass in proxy.

- [ ] 4.1 Add `registry_repos` table to `db/client.ts`
- [ ] 4.2 Create `src/db/registry.ts`: upsert, visibility, delete CRUD
- [ ] 4.3 Create `src/registry/client.ts`: internal Zot API (list repos, list tags, get manifest, delete)
- [ ] 4.4 Create `src/api/registry.ts`: GET /api/registry, GET /api/registry/:app, PATCH (visibility), DELETE (app + tag)
- [ ] 4.5 Update `proxy.ts`: skip auth for public repo GET/HEAD requests
- [ ] 4.6 Register routes in `src/app.ts`
- [ ] 4.7 Unit test: `__tests__/registry-api.test.ts`
- [ ] 4.8 E2E: `e2e/tests/registry.test.ts` (list, visibility, delete)

**Success:** `bun run test && bun run test:e2e` pass. Image listing, deletion, and public access all work.

---

## Group 5: Registry Completeness & Full E2E Validation
**Status:** ⬜ pending | **E2E:** ✓ full suite (green checkpoint)
**Goal:** `triggered_by` field, `ROLLHOOK_URL` env var, integration E2E proving full push→deploy flow. No auto-deploy on push — deploy is always explicit.

- [ ] 5.1 Add `triggered_by TEXT NOT NULL DEFAULT 'api'` column to jobs table
- [ ] 5.2 Update `db/jobs.ts`, `api/deploy.ts`, `packages/rollhook/src/types.ts`
- [ ] 5.3 Add `ROLLHOOK_URL` env var support + surface in deploy response
- [ ] 5.4 E2E: `e2e/tests/registry-deploy.test.ts` (push → explicit deploy → container updated)
- [ ] 5.5 Hardening pass: error handling, security review, log quality
- [ ] 5.6 Update `CLAUDE.md` env var table

**Success:** `bun run test && bun run test:e2e` fully green. All registry + deploy flows proven.

---

## Group 6: Dashboard Registry UI
**Status:** ⬜ pending | **E2E:** – skip (visual, validate manually)
**Goal:** Registry section in dashboard: image list, version history, OCI labels, deletion, public/private toggle, pull command.

- [ ] 6.1 Add `/registry` route + nav entry
- [ ] 6.2 `RegistryPage`: image list with latest tag, size, version count
- [ ] 6.3 `RegistryAppDetail`: version list with git SHA, size, push time, delete buttons
- [ ] 6.4 Public/private toggle (calls PATCH endpoint)
- [ ] 6.5 Pull command with copy button
- [ ] 6.6 Cross-link: job history ↔ registry version
- [ ] 6.7 Handle 503 gracefully (registry "starting" state)

**Success:** `bun run typecheck && bun run lint` pass. Manual visual verification passes.

---

## Group 7: GitHub Action Rewrite
**Status:** ⬜ pending | **E2E:** ✓ final full suite
**Goal:** Composite `rollhook-action@v1` wrapping build+push+deploy. External registry mode. Multi-container support. Update `release.yml`.

- [ ] 7.1 Rewrite `action.yml` as composite (in `~/SourceRoot/rollhook-action`)
- [ ] 7.2 Implement deploy trigger step (POST /deploy with `triggered_by: ci`)
- [ ] 7.3 Implement wait/poll step (bash: poll + SSE log streaming)
- [ ] 7.4 Remove old TypeScript source, `dist/`, `package.json` from rollhook-action
- [ ] 7.5 Update `rollhook-action/README.md` with all usage examples
- [ ] 7.6 Update `rollhook/.github/workflows/release.yml` to use new action
- [ ] 7.7 Update `rollhook/CLAUDE.md`
- [ ] 7.8 Final E2E: `bun run test:e2e` fully green

**Success:** `release.yml` ≤ 20 lines for the deploy job. `bun run test:e2e` green.
