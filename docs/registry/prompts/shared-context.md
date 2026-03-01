# RollHook — Shared Implementation Context

You are implementing the **Zot registry integration** for RollHook. Read this context fully before starting.

---

## What RollHook Is

A self-hosted Docker Compose deployment tool. Users run it on a VPS. GitHub Actions push images to RollHook's embedded registry, then explicitly call `/deploy` to trigger a zero-downtime rolling deploy via Docker REST API. No external dependencies beyond Docker.

**Core flow:**
1. `docker push rollhook.domain.com/app:sha` → image stored in embedded Zot registry
2. GitHub Action calls `POST /deploy` with `image_tag` → RollHook runs rolling deploy
3. Dashboard shows images, versions, job history

**External registry path still works:** users may pass an arbitrary `image_tag` to `/deploy` that points to ghcr.io, Docker Hub, or any other registry. RollHook will `docker pull` it and deploy. Mixed usage is fine (some apps on RollHook registry, some on external registries).

---

## Repository Layout

```
rollhook/                            # monorepo root
  apps/server/                       # @rollhook/server — Elysia API :7700
    src/
      app.ts                         # Elysia app composition (no .listen())
      api/deploy.ts                  # POST /deploy
      api/health.ts                  # GET /health
      api/jobs.ts                    # GET /jobs/:id, /jobs/:id/logs (SSE), /jobs
      middleware/auth.ts             # Bearer token auth plugin
      jobs/executor.ts               # Job orchestrator
      jobs/queue.ts                  # In-memory FIFO queue
      jobs/notifier.ts               # Pushover + webhook notifications
      jobs/steps/discover.ts         # Docker label discovery
      jobs/steps/pull.ts             # docker pull via REST API
      jobs/steps/validate.ts         # Pre-deploy validation
      jobs/steps/rollout.ts          # TypeScript rolling deploy
      docker/client.ts               # dockerFetch() — Docker REST API
      docker/api.ts                  # Hardened Docker adapter
      docker/types.ts                # Docker API response types
      db/client.ts                   # bun:sqlite + auto-migrations
      db/jobs.ts                     # Job CRUD
      __tests__/                     # Unit tests (bun:test)
        preload.ts                   # Sets env vars before any import
        auth.test.ts, discover.test.ts, docker-api.test.ts, env.test.ts,
        notifier.test.ts, queue.test.ts, validate.test.ts
    server.ts                        # Entry: .listen(7700)
    Dockerfile                       # Multi-stage: tool-downloader + runner
  apps/dashboard/                    # React dashboard (builds into server's static)
  apps/marketing/                    # Astro marketing site
  packages/rollhook/                 # Shared TS types (npm published)
  e2e/                               # Vitest E2E tests (requires Docker host)
    tests/                           # auth, deploy, failure, health, jobs, queue, zero-downtime
    setup/global.ts                  # Builds Docker image, spins up compose stack
    setup/fixtures.ts                # Token constants, helpers, pollJobUntilDone
    compose.e2e.yml                  # Traefik + registry + RollHook container
```

---

## Tech Stack

- **Runtime:** Bun 1.3.9
- **Language:** TypeScript 6.0.0-beta, strict mode
- **Backend:** Elysia 1.4.x (Bun-native, OpenAPI, bearer auth plugin)
- **Database:** `bun:sqlite` — `data/rollhook.db`
- **Linting/Formatting:** `@antfu/eslint-config` (ESLint flat, handles formatting, no Prettier)
- **Testing:** bun:test (unit), Vitest (E2E)
- **Path alias:** `@/*` → `apps/server/src/*` (defined in `apps/server/tsconfig.json`)

---

## Data Volume

All persistent data lives in `/app/data/` (the bound volume):
- `rollhook.db` — SQLite database
- `registry/` — Zot blob/manifest storage
- Any generated configs (htpasswd, zot config)

This means a single volume backup captures the entire RollHook state (database + all stored images). Always ensure new persistent state goes into `/app/data/`.

---

## Auth (after Group 1)

Single env var: `ROLLHOOK_SECRET` — grants all access (replaces `ADMIN_TOKEN` + `WEBHOOK_TOKEN`).

**Startup validation:** reject startup if `ROLLHOOK_SECRET` is missing or shorter than 7 characters. Clear error message. No silent failure.

**Zot internal auth:** Zot uses `ROLLHOOK_SECRET` directly as its internal password (bcrypt-hashed into `.htpasswd` at startup). No separate random credential. `getInternalCredentials()` simply returns `{ user: 'rollhook', password: ROLLHOOK_SECRET }`. The proxy translates the incoming `Bearer ROLLHOOK_SECRET` into `Basic base64(rollhook:ROLLHOOK_SECRET)` for Zot. Deterministic, no in-memory state, same behavior across restarts.

---

## Registry — Always On

The embedded Zot registry always starts. There is no `ENABLE_REGISTRY` flag.

Users who push to RollHook registry: `docker push rollhook.domain.com/myapp:sha`
Users with external images: call `POST /deploy` with any `image_tag` (ghcr.io, Docker Hub, etc.)
Mixed usage: perfectly fine — some apps on RollHook registry, others on external registries.

**No auto-deploy on push.** The deploy step is always an explicit `POST /deploy` call. This gives users full control: push to staging registry → promote to prod explicitly, or just push + immediately deploy in CI.

---

## Elysia Auth Pattern (critical)

Auth uses `onBeforeHandle({ as: 'local' })`. Routes MUST chain onto the `requireRole(...)` return value:

```typescript
// CORRECT:
requireRole('admin').get('/route', handler)

// WRONG:
new Elysia().use(requireRole('admin')).get('/route', handler)
```

---

## Coding Standards

- TypeScript strict, no `any` without comment justification
- Low nesting: early returns, guard clauses
- No `process` as global — `import process from 'node:process'`
- No `console.log` in production — write to log file or use structured output
- Errors bubble up — no silent catch blocks
- No premature abstraction

---

## Greenfield — Breaking Changes OK

This is a greenfield project with zero external users. Every user starts fresh. Breaking changes to the DB schema, API, env vars, or Docker image are completely fine. No backward-compat shims, no migration guards.

---

## Research Before Implementing

**Always start by:**

1. **Explore the codebase first** — use the Explore agent or Grep/Glob to read the files listed in your group's prompt. Understand the existing patterns before writing anything.
2. **Research unfamiliar APIs** — if your group involves an external library, CLI tool, or protocol you're uncertain about, use WebFetch or WebSearch to read current docs. Don't guess at APIs.
3. **Question the prompt** — the group prompts are direction, not prescription. If you see a cleaner implementation approach while exploring, use it. Document the deviation in the learning notes.

---

## Validation Command

After every implementation:
```bash
bun run typecheck && bun run lint && bun run test
```

Fix ALL errors. Do not skip lint issues.

**E2E:** Each group's prompt specifies whether to run E2E. When instructed:
```bash
bun run test:e2e
```

E2E requires Docker and is only run in groups where it's explicitly useful.

---

## Learning Notes

After completing your implementation (before the completion signal), **always append** a section to `docs/registry/RALPH_NOTES.md`:

```markdown
## Group N: <title>

### What was implemented
<1-3 sentences>

### Deviations from prompt
<if any — what you changed and why>

### Gotchas & surprises
<anything unexpected>

### Security notes
<any security-relevant decisions>

### Tests added
<list of new test files/cases>

### Future improvements
<things deferred, better approaches possible, tech debt noted>
```

If `RALPH_NOTES.md` doesn't exist yet, create it.

---

## Commit Format

Conventional commits, no AI attribution:
```
feat(registry): <description>
```

Stage only the files you modified. Commit before signaling completion.

---

## Completion Signal

When fully done (tests pass, committed, learning notes written):
```
RALPH_TASK_COMPLETE: Group N
```

If blocked:
```
RALPH_TASK_BLOCKED: Group N - <reason>
```
