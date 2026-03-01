# RollHook — Go Rewrite Plan

## Vision

**The apex implementation of RollHook: a simple, production-grade mini PaaS for people who want to self-host on a VPS with Docker Compose without fear.**

GitHub push → zero-downtime container swap on your VPS. One binary. One secret. One volume to back up. No cloud vendor lock-in. The reason people are scared of VPS and reach for Vercel — removed.

**Greenfield. No external users. No backwards compatibility. Build it right.**

---

## What Changes

The entire Elysia/Bun/TypeScript server is replaced by a single Go binary. The Go binary is ~20MB static, bundles no runtime, embeds the dashboard static files, and uses first-class Go libraries for every integration point:

- **Docker SDK** (`github.com/docker/docker/client`) — same library as Docker CLI. Typed, streaming, no hand-rolled HTTP parsing.
- **compose-go** (`github.com/compose-spec/compose-go/v2`) — official Compose file parser for validation and env resolution.
- **go-containerregistry** (`github.com/google/go-containerregistry`) — verify images exist in registry before dispatching jobs.
- **httputil.ReverseProxy** — stdlib OCI proxy, native streaming, no body buffering.
- **huma v2** — code-first OpenAPI 3.1 from Go types. Scalar UI at `/openapi`.
- **Chi v5** — stdlib-compatible router, zero magic.
- **modernc.org/sqlite** — pure Go SQLite, no CGO, works in Alpine.

**What stays TypeScript:**
- `apps/dashboard/` — React + orval-generated API client from the Go OpenAPI spec
- `apps/marketing/` — Astro, separate Docker image, Go never touches it
- `packages/rollhook/` — npm types package for external consumers
- `e2e/` — Vitest, tests the HTTP surface, language-agnostic

---

## Architecture

```
GitHub Actions
  └── rollhook-action@v1
        ├── docker login    rollhook.domain.com  (ROLLHOOK_SECRET as password)
        ├── docker build+push → rollhook.domain.com/app:sha
        └── POST /deploy    { image_tag: "rollhook.domain.com/app:sha" }

Internet → Traefik (TLS) → RollHook Go binary :7700
                                ├── GET  /health                    (no auth)
                                ├── GET  /openapi                   (no auth — Scalar)
                                ├── GET  /openapi.json              (no auth — spec)
                                ├── POST /deploy                    (ROLLHOOK_SECRET)
                                ├── GET  /jobs                      (ROLLHOOK_SECRET)
                                ├── GET  /jobs/{id}                 (ROLLHOOK_SECRET)
                                ├── GET  /jobs/{id}/logs            (SSE, ROLLHOOK_SECRET)
                                └── /v2/*  ──────────────────────────────────────────────┐
                                                                                         │
                                           httputil.ReverseProxy (stdlib)                │
                                           • auth: ROLLHOOK_SECRET (Bearer or Basic)     │
                                           • Location header rewrite                     │
                                           • native streaming — no buffering             │
                                                                                         ▼
                                                        Zot :5000 (127.0.0.1 — loopback only)
                                                        • blobs + manifests in /app/data/registry/
                                                        • config + htpasswd auto-generated at startup
                                                        • always running — no flag to disable
```

---

## New Monorepo Structure

```
rollhook/
  go.mod                             # module github.com/jkrumm/rollhook
  go.sum
  .golangci.yml                      # Go linter config
  cmd/
    rollhook/
      main.go                        # Entry: secret validation, start services, SIGTERM
  internal/
    api/
      deploy.go                      # POST /deploy
      jobs.go                        # GET /jobs, GET /jobs/{id}, GET /jobs/{id}/logs (SSE)
      health.go                      # GET /health
    middleware/
      auth.go                        # Bearer token middleware (ROLLHOOK_SECRET)
    docker/
      client.go                      # Docker SDK init from DOCKER_HOST / socket
      api.go                         # ContainerList, Inspect, ImagePull (streaming), Stop, Remove
    jobs/
      queue.go                       # Go channel FIFO queue, sequential processing
      executor.go                    # Orchestrate: discover → validate → pull → rollout → notify
      steps/
        discover.go                  # Docker SDK labels → compose_path + service
        validate.go                  # compose-go: parse file, check image referenced
        pull.go                      # Docker SDK ImagePull, streaming logs, X-Registry-Auth
        rollout.go                   # docker compose up --scale + health poll + drain
    registry/
      manager.go                     # Zot subprocess (os/exec), health poll, graceful stop
      proxy.go                       # httputil.ReverseProxy + auth + Location rewrite
      config.go                      # generateZotConfig, generateHtpasswd (bcrypt)
    db/
      client.go                      # modernc.org/sqlite init, migrations
      jobs.go                        # Job CRUD
    notifier/
      notifier.go                    # Pushover + NOTIFICATION_WEBHOOK_URL
    state/
      state.go                       # Shutdown flag (503 on /health during drain)
  apps/
    dashboard/                       # React — bun build → dist/ → //go:embed
    marketing/                       # Astro — separate Docker image, Go never touches it
  packages/
    rollhook/                        # npm types (JobResult, JobStatus) — stays TypeScript
  e2e/                               # Vitest E2E — survives migration unchanged
  scripts/
    ralph-go.sh                      # This RALPH loop
  docs/
    go-rewrite/                      # This directory
  Dockerfile                         # Multi-stage: Go build + Zot/Docker tool download
```

---

## Key Design Decisions

| Decision | Choice | Why |
|-|-|-|
| Router | Chi v5 | stdlib-compatible, zero magic |
| OpenAPI | huma v2 | code-first OpenAPI 3.1, Chi adapter, no annotations |
| API docs | Scalar | cleaner than Swagger, same HTML embed pattern |
| SQLite | modernc.org/sqlite | pure Go, no CGO, works in Alpine without GCC |
| Docker | docker/docker client SDK | official, typed, same as CLI |
| Compose parsing | compose-go v2 | official parser, resolves .env + OS env |
| Registry client | go-containerregistry | verify images exist before deploying |
| OCI proxy | httputil.ReverseProxy | stdlib, native streaming |
| bcrypt | golang.org/x/crypto/bcrypt | stdlib-adjacent, no extra deps |
| Dashboard types | orval + openapi-typescript | generated from Go's OpenAPI spec |

---

## Migration Strategy

Groups 1–7 build the Go server alongside the existing Bun server. The Dockerfile always builds the Go binary, but the CMD still points to Bun until Group 8. This means Go unit tests work throughout, E2E tests are only fully switched in Group 8.

**Group 8 is the cutover**: Dockerfile CMD switches to Go binary, Bun server deleted, E2E suite runs against Go.

---

## Group Table

| # | Title | Validation | Key Deliverable |
|-|-|-|-|
| 1 | Go Module + Skeleton | `go build + go test` | Go binary exists, `/health` works, Dockerfile updated |
| 2 | Auth + OpenAPI + Scalar | `go test` + curl | 401 on protected routes, Scalar renders |
| 3 | SQLite + Job Persistence | `go test ./internal/db/...` | Job CRUD, log files |
| 4 | Docker SDK Integration | `go test ./internal/docker/...` | Container ops, streaming pull |
| 5 | Zot Manager + OCI Proxy | `go test` + manual push/pull | Zot starts, proxy works, native streaming |
| 6 | Job Queue + Discovery + Validate | `go test ./internal/jobs/...` | Queue, compose label discovery |
| 7 | Pull + Rolling Deploy + Notifier | `go test ./internal/jobs/...` | Full deploy pipeline, notifier |
| 8 | Full API + Wire-Up | `go build + go test` + curl | All handlers wired, server runs end-to-end |
| 9 | Dockerfile Cutover + E2E Quality Pass | **`bun run test:e2e` all pass** | Go is the server, Bun deleted, E2E as quality signal |
| 10 | OpenAPI Polish + Orval + Cleanup | `go build + bun typecheck` | Types generated, README, CLAUDE.md updated |

---

## Running the RALPH Loop

```bash
# Run all pending groups
./scripts/ralph-go.sh

# Check current status
./scripts/ralph-go.sh --status

# Run a specific group
./scripts/ralph-go.sh 3

# Reset and retry a group
./scripts/ralph-go.sh --reset 3 && ./scripts/ralph-go.sh 3
```

Logs (quiet by default): `.ralph-go-logs/group-N.log`
State: `.ralph-go-tasks.json`
Report: `docs/go-rewrite/RALPH_REPORT.md`
Learning notes: `docs/go-rewrite/RALPH_NOTES.md`

**To watch a group in real-time:**
```bash
tail -f .ralph-go-logs/group-N.log
```

---

## Success Criteria

- [ ] `go build ./...` — single binary, no CGO required
- [ ] `go test ./...` — all Go unit tests pass
- [ ] `bun run test:e2e` — all 56 E2E tests pass against Go server
- [ ] `docker push <rollhook-url>/app:sha` — stored in embedded Zot, no buffering
- [ ] `POST /deploy` + `GET /jobs/{id}/logs` — rolling deploy with live SSE log stream
- [ ] `/openapi` — Scalar renders all endpoints with auth scheme
- [ ] `bun run generate:api` in dashboard — generates typed React Query hooks from spec
- [ ] No Bun/TypeScript anywhere in the server runtime path
- [ ] One volume backup: `rsync /app/data/ backup/`

---

## What This Is NOT

- Not Harbor, Nexus, or any multi-tenant registry
- Not a Kubernetes operator or Helm replacement
- Not a multi-server orchestrator (one VPS, one Docker socket)
- Not magic: push does NOT auto-deploy — deploy is always an explicit call
- Not a startup-funded product — a focused tool for developers who own their infrastructure
