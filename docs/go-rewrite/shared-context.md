# RollHook — Go Rewrite Shared Context

You are implementing the **Go rewrite of RollHook**. Read this fully before starting your group.

---

## What RollHook Is

A self-hosted Docker Compose deployment tool. Users run it on a VPS. GitHub Actions push images to RollHook's embedded registry, then explicitly call `POST /deploy` to trigger a zero-downtime rolling deploy via Docker REST API.

**Core flow:**
1. `docker push rollhook.domain.com/app:sha` → stored in embedded Zot registry (via RollHook OCI proxy)
2. GitHub Action calls `POST /deploy { image_tag }` → RollHook runs rolling deploy
3. Dashboard + API show job history, live logs, deployed versions

**External registry still works:** any `image_tag` pointing to ghcr.io, Docker Hub, etc. is pulled and deployed. Mixed usage (some apps on RollHook registry, some on external) is fine.

---

## Current State of the Repo

The existing Bun/TypeScript/Elysia server lives in `apps/server/`. It works and has 56 passing E2E tests and 98 unit tests. **You are building the Go replacement alongside it.** The Bun server is not touched or broken during Groups 1–7. Group 8 kills it.

Reference the TypeScript implementation to understand existing behaviour — but do not copy its patterns into Go. Use idiomatic Go.

---

## Repository Layout (after migration)

```
rollhook/
  go.mod / go.sum / .golangci.yml
  cmd/rollhook/main.go               # entry point
  internal/
    api/        deploy.go, jobs.go, health.go
    middleware/  auth.go
    docker/     client.go, api.go
    jobs/       queue.go, executor.go, steps/{discover,validate,pull,rollout}.go
    registry/   manager.go, proxy.go, config.go
    db/         client.go, jobs.go
    notifier/   notifier.go
    state/      state.go
  apps/
    dashboard/  (React, builds to dist/, embedded via //go:embed)
    marketing/  (Astro, separate image — Go never touches it)
  packages/rollhook/   (npm types, stays TypeScript)
  e2e/                 (Vitest E2E, tests HTTP surface, unchanged)
  apps/server/         (Bun/Elysia — DELETE in Group 8)
```

---

## Tech Stack (Go server)

| Concern | Library |
|-|-|
| Router | `github.com/go-chi/chi/v5` |
| OpenAPI 3.1 | `github.com/danielgtaylor/huma/v2` |
| SQLite | `modernc.org/sqlite` (pure Go, no CGO) |
| Docker SDK | `github.com/docker/docker/client` |
| Compose parsing | `github.com/compose-spec/compose-go/v2` |
| Registry client | `github.com/google/go-containerregistry` |
| OCI proxy | `net/http/httputil` (stdlib) |
| bcrypt | `golang.org/x/crypto/bcrypt` |
| Go version | 1.23+ |

---

## Auth

Single env var: `ROLLHOOK_SECRET` — minimum 7 characters, validated at startup.

```go
// Startup check in main.go
secret := os.Getenv("ROLLHOOK_SECRET")
if len(secret) < 7 {
    log.Fatal("ROLLHOOK_SECRET must be set and at least 7 characters")
}
```

Bearer token middleware — one function, no role system:
```go
func RequireAuth(secret string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
            if token != secret {
                w.WriteHeader(http.StatusUnauthorized)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

No roles. No plugin system. No gotchas.

---

## Zot Registry (always on)

Zot starts as a subprocess before the HTTP server starts. No `ENABLE_REGISTRY` flag.

Internal credentials: `username=rollhook`, `password=ROLLHOOK_SECRET`. Deterministic — same every restart.

Zot binds `127.0.0.1:5000` — never exposed externally. The Go server proxies `/v2/*` via `httputil.ReverseProxy`.

External clients authenticate with ROLLHOOK_SECRET (Bearer or Basic with any username). The proxy translates to `Basic base64(rollhook:ROLLHOOK_SECRET)` for Zot.

---

## OCI Proxy — No Body Buffering

`httputil.ReverseProxy` streams naturally. No `io.ReadAll` on request bodies. This was the critical limitation of the TypeScript implementation.

```go
proxy := httputil.NewSingleHostReverseProxy(zotURL)
proxy.ModifyResponse = rewriteLocationHeaders
// wrap with auth middleware
```

---

## Data Volume

All persistent data in `/app/data/` (the bound Docker volume):
- `rollhook.db` — SQLite
- `registry/` — Zot blobs, config.json, .htpasswd
- `logs/<job-id>.log` — raw job output (streamed via SSE)

One volume = one backup: `rsync /app/data/ backup/`

---

## Job Flow

```
POST /deploy { image_tag }
  → enqueue job (FIFO, one at a time)
  → discover: docker SDK ContainerList → labels → compose_path + service
  → validate: compose file exists, compose-go parses it, image referenced
  → pull: docker SDK ImagePull (streaming), X-Registry-Auth for localhost registries
  → rollout: docker compose up --scale + health poll + drain old containers
  → notify: Pushover + NOTIFICATION_WEBHOOK_URL (if configured)
GET /jobs/{id}/logs → SSE stream of data/logs/<id>.log (tail -f equivalent)
```

---

## Coding Standards (Go)

- Idiomatic Go — no over-engineering, no unnecessary abstractions
- Early returns and guard clauses over nested ifs
- Errors returned, not swallowed — no empty catch/recover blocks
- `log/slog` for structured logging (not fmt.Println)
- No global mutable state except the shutdown flag
- Table-driven tests where appropriate
- `//go:embed` for dashboard static files
- `internal/` for all non-entrypoint packages (nothing is importable externally)

---

## Research Before Implementing

**Always start by:**
1. Explore the codebase with Glob/Grep/Read — understand existing patterns in the TypeScript server for the functionality you're porting
2. Research unfamiliar Go libraries with Context7 or WebFetch or Tavily Search + WebFetch — check actual API signatures, not what you assume
3. Check `go.mod` to see what's already imported before adding dependencies
4. The group prompt is direction, not prescription — use a better approach if you find one

---

## Validation Commands

**Go:**
```bash
go build ./...          # must compile clean
go vet ./...            # must be clean
go test ./...           # all tests pass
golangci-lint run       # must be clean (if golangci-lint installed)
```

**TypeScript (only when touching TS files):**
```bash
bun run typecheck
bun run lint
```

**E2E (only when instructed — requires Docker):**
```bash
bun run test:e2e
```

---

## Learning Notes

After completing each group, **always append** to `docs/go-rewrite/RALPH_NOTES.md`:

```markdown
## Group N: <title>

### What was implemented
<1-3 sentences>

### Deviations from prompt
<what you changed and why>

### Gotchas & surprises
<anything unexpected — library APIs, Go idioms, stdlib quirks>

### Security notes
<security-relevant decisions>

### Tests added
<list of test files/functions>

### Future improvements
<deferred work, tech debt, better approaches possible>
```

---

## Commit Format

Conventional commits, no AI attribution:
```
feat(server): <description>
refactor(server): <description>
```

Stage only modified files. Commit before signaling completion.

---

## Completion Signal

```
RALPH_TASK_COMPLETE: Group N
```

If blocked:
```
RALPH_TASK_BLOCKED: Group N - <reason>
```
