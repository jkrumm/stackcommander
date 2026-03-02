# RollHook — Project Configuration

## Project Overview

Webhook-driven rolling deployment orchestrator for Docker Compose stacks on self-hosted VPS. Receives GitHub Actions webhook calls, runs zero-downtime rolling deployments via Docker REST API, and streams job logs back to CI.

**Stateless design:** No server-side config file needed. RollHook discovers the compose file and service name automatically from the running container's Docker Compose labels (`com.docker.compose.project.config_files` + `com.docker.compose.service`). The `image_tag` is the discovery key — one image = one service.

**Companion repo:** `~/SourceRoot/rollhook-action` (`jkrumm/rollhook-action`) — GitHub Action that triggers deploys and streams SSE logs live to CI. Versioned independently (`v1.x`). Users reference it as `uses: jkrumm/rollhook-action@v1`.

See: `~/Obsidian/Vault/03_Projects/rollhook.md`
North Star Stack: `~/Obsidian/Vault/04_Areas/Engineering/north-star-stack.md`

---

## Repository Layout

```
rollhook/
  go.mod / go.sum / .golangci.yml
  cmd/
    rollhook/main.go              # Entry point — validates env, starts Zot, DB, executor, HTTP
    gendocs/main.go               # Spec generator — go run ./cmd/gendocs > apps/dashboard/openapi.json
  internal/
    api/         health.go, deploy.go, jobs.go
    middleware/  auth.go
    docker/      client.go, api.go
    jobs/        queue.go, executor.go, steps/{discover,validate,pull,rollout}.go
    registry/    manager.go, proxy.go, config.go
    db/          client.go, jobs.go
    notifier/    notifier.go
    state/       state.go
  apps/
    dashboard/   React SPA (Vite, embedded via //go:embed — WIP)
    marketing/   Astro marketing site (separate image)
  packages/
    rollhook/    npm types package (JobResult, JobStatus)
  e2e/           Vitest E2E tests (56 tests, tests HTTP surface)
  examples/      Reference compose stacks, bun-hello-world app
  docs/
    go-rewrite/  RALPH_NOTES.md, PLAN.md — implementation notes
```

---

## Tech Stack

| Layer           | Choice                                           |
| --------------- | ------------------------------------------------ |
| Language        | Go 1.24.1                                        |
| Router          | `github.com/go-chi/chi/v5`                       |
| OpenAPI 3.1     | `github.com/danielgtaylor/huma/v2`               |
| API Docs        | Scalar UI at `/openapi`, spec at `/openapi.json` |
| SQLite          | `modernc.org/sqlite` (pure Go, no CGO)           |
| Docker SDK      | `github.com/docker/docker/client`                |
| Compose parsing | `github.com/compose-spec/compose-go/v2`          |
| Registry        | Zot (embedded subprocess, `127.0.0.1:5000`)      |
| OCI proxy       | `net/http/httputil` (stdlib)                     |
| E2E tests       | Vitest (Bun-run), tests HTTP surface             |
| Dashboard       | React 19, Vite, basalt-ui, Tailwind v4           |
| Marketing       | Astro 5 (separate image, not touched by Go)      |

---

## Go Commands

Go is **not** installed locally — all Go commands run via Docker:

```bash
docker run --rm -v "$(pwd)":/workspace -w /workspace golang:1.24-alpine \
  go build ./...

docker run --rm -v "$(pwd)":/workspace -w /workspace golang:1.24-alpine \
  go test ./...

# Generate openapi.json from huma operation definitions:
docker run --rm -v "$(pwd)":/workspace -w /workspace golang:1.24-alpine \
  go run ./cmd/gendocs > apps/dashboard/openapi.json
```

CI runs `go build ./...`, `go vet ./...`, `go test ./...` natively (Go installed in CI).

---

## Package Manager

**Bun** — used for TypeScript tooling (E2E, dashboard, marketing, linting).

```bash
bun install                                      # Install all workspace deps
bun run --filter @rollhook/dashboard generate:api  # Regenerate API types from spec
bun run typecheck                                # Type-check TypeScript workspaces
bun run lint                                     # Lint monorepo
bun run lint:fix                                 # Auto-fix
bun run test:e2e                                 # E2E tests (requires Docker)
```

---

## Root Scripts

| Command                   | Action                                              |
| ------------------------- | --------------------------------------------------- |
| `bun run generate:api`    | Regenerate `src/api/generated/` from `openapi.json` |
| `bun run typecheck`       | Type-check all workspaces                           |
| `bun run lint`            | Lint entire monorepo                                |
| `bun run lint:fix`        | Auto-fix lint + formatting                          |
| `bun run test:e2e`        | E2E tests (requires Docker)                         |
| `bun run build:dashboard` | Vite build for dashboard                            |

---

## Auth

Single `ROLLHOOK_SECRET` bearer token. Min 7 characters, validated at startup.

```go
// Startup check in cmd/rollhook/main.go:
secret := os.Getenv("ROLLHOOK_SECRET")
if len(secret) < 7 {
    log.Fatal("ROLLHOOK_SECRET must be set and at least 7 characters")
}
```

Auth middleware (`internal/middleware/auth.go`): `strings.CutPrefix` for Bearer parsing — rejects missing prefix, not just wrong token.

huma enforces auth via `UseMiddleware` checking `ctx.Operation().Security`. Public endpoints (`/health`, `/openapi`) have no `Security` field.

SSE endpoint (`/jobs/{id}/logs`) uses `middleware.RequireAuth(secret)` as a chi middleware (bypasses huma).

---

## Environment Variables

| Var                        | Required | Purpose                                        |
| -------------------------- | -------- | ---------------------------------------------- |
| `ROLLHOOK_SECRET`          | yes      | Bearer token (min 7 chars), all routes         |
| `DOCKER_HOST`              | no       | Docker daemon endpoint (default: local socket) |
| `PORT`                     | no       | Listen port (default: `7700`)                  |
| `DATA_DIR`                 | no       | Data directory (default: `data`)               |
| `PUSHOVER_USER_KEY`        | no       | Pushover user key                              |
| `PUSHOVER_APP_TOKEN`       | no       | Pushover app token                             |
| `NOTIFICATION_WEBHOOK_URL` | no       | URL to POST job result JSON on completion      |

---

## SQLite

`modernc.org/sqlite` — `data/rollhook.db`, no CGO, no external deps.

- `SetMaxOpenConns(1)` — serializes writes through one connection (prevents SQLITE_BUSY)
- WAL mode — readers don't block the single writer
- Job logs: `data/logs/<job-id>.log` (flat files, SSE-streamed via `GET /jobs/{id}/logs`)
- `data/` is gitignored

---

## Zot Registry

Always-on embedded registry subprocess. Binds `127.0.0.1:5000`. Not externally accessible.

**Key gotcha:** Zot pre-built binaries are dynamically linked (glibc). Use `debian:12-slim` runner, NOT Alpine. Alpine fails with ELF interpreter mismatch even though the binary file exists.

**Docker2s2 compat mode** required in Zot config (`http.compat: ["docker2s2"]`). Without it, Zot rejects Docker v2 manifests (415) — `distSpecVersion` alone is not sufficient.

---

## API Surface

```
POST  /deploy              # Bearer auth — enqueue rolling deploy
GET   /jobs/{id}           # Bearer auth — job status + metadata
GET   /jobs/{id}/logs      # Bearer auth — SSE log stream (text/event-stream)
GET   /jobs                # Bearer auth — paginated history (?app=&status=&limit=)
GET   /health              # No auth — status + version
GET   /openapi             # No auth — Scalar UI
GET   /openapi.json        # No auth — OpenAPI 3.1 spec
GET   /v2/*                # Bearer/Basic auth — OCI proxy to Zot
```

OpenAPI spec is served at `/openapi.json` (huma default). Scalar UI is wired at `/openapi`.

---

## Go Key Patterns

### huma middleware auth

Operations with `Security: []map[string][]string{{"bearer": {}}}` are checked by the huma `UseMiddleware` before the handler runs. Operations with no `Security` field are public.

### huma response status

Always initialize `out.Status = http.StatusOK` immediately after `out := &FooOutput{}`. Zero value (0) → `WriteHeader(0)` → panic.

### SQLite concurrency

`SetMaxOpenConns(1)` serializes all DB access. `busy_timeout=5000` is per-connection so it does NOT help with pool concurrency — only `SetMaxOpenConns(1)` fixes SQLITE_BUSY.

### Docker SDK v28

`ContainerList` returns `[]container.Summary` (not `types.Container`). Options types are in sub-packages (`container`, `image` under `api/types/`).

---

## orval API Generation

Generated types live in `apps/dashboard/src/api/generated/`. Committed as a baseline.

**Regeneration workflow:**

1. Change huma operations (add/modify endpoints)
2. `docker run ... go run ./cmd/gendocs > apps/dashboard/openapi.json` — regenerate spec
3. `bun run generate:api` — regenerate TypeScript types
4. Commit `openapi.json` + `src/api/generated/` together

The custom fetch instance (`src/api/client.ts`) injects `Authorization: Bearer <token>` on all calls. Call `setApiToken(token)` after authentication.

---

## npm Package `rollhook`

Publishes shared TypeScript types. Published via `/release` skill.

```ts
export type { JobResult, JobStatus }
```

---

## Git Workflow

Follow SourceRoot conventions (see `~/SourceRoot/CLAUDE.md`):

- `/commit` for conventional commits
- `/pr` for GitHub PR workflow
- No ticket numbers (personal project)
- No AI attribution
- **NEVER use `!` or `BREAKING CHANGE` in commits** — this is a greenfield project with no external consumers. All changes are `feat:` or `fix:`, never `feat!:`. Major version bumps are forbidden.
