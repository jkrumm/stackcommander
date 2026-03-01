# Group 1: Go Module + Project Skeleton

## What You're Doing

Initialize the Go module and project structure. Get a single binary that starts, validates `ROLLHOOK_SECRET`, and serves `/health`. Update the Dockerfile to build the Go binary alongside the existing Bun server (CMD stays Bun for now — switched in Group 8). Establish the linting config and Go conventions for the rest of the rewrite.

---

## Research & Exploration First

1. Read `apps/server/server.ts` and `apps/server/src/api/health.ts` — understand what the health endpoint returns and how startup validation works
2. Read the current `Dockerfile` — understand the multi-stage structure, which tools are bundled (Zot, Docker CLI), and where to add the Go build stage
3. Check `package.json` root — understand what scripts exist, which may need Go equivalents
4. Research `github.com/danielgtaylor/huma/v2` quickly — understand its Chi adapter setup (you'll wire it in Group 2, but import it now so the module is consistent)

---

## What to Implement

### 1. Go module

At the repo root:

```
go mod init github.com/jkrumm/rollhook
```

Dependencies to add (run `go get`):
- `github.com/go-chi/chi/v5`
- `github.com/danielgtaylor/huma/v2`
- `modernc.org/sqlite`
- `github.com/docker/docker` (the client package)
- `github.com/compose-spec/compose-go/v2`
- `github.com/google/go-containerregistry`
- `golang.org/x/crypto`

### 2. Project structure

Create the full directory skeleton (empty files are fine — just the dirs and placeholder `package` declarations):

```
cmd/rollhook/main.go
internal/api/health.go
internal/api/deploy.go
internal/api/jobs.go
internal/middleware/auth.go
internal/docker/client.go
internal/docker/api.go
internal/jobs/queue.go
internal/jobs/executor.go
internal/jobs/steps/discover.go
internal/jobs/steps/validate.go
internal/jobs/steps/pull.go
internal/jobs/steps/rollout.go
internal/registry/manager.go
internal/registry/proxy.go
internal/registry/config.go
internal/db/client.go
internal/db/jobs.go
internal/notifier/notifier.go
internal/state/state.go
```

### 3. `cmd/rollhook/main.go`

```go
package main

func main() {
    secret := os.Getenv("ROLLHOOK_SECRET")
    if len(secret) < 7 {
        log.Fatal("ROLLHOOK_SECRET must be set and at least 7 characters")
    }

    r := chi.NewRouter()
    r.Get("/health", healthHandler)

    port := os.Getenv("PORT")
    if port == "" {
        port = "7700"
    }

    slog.Info("RollHook starting", "port", port)
    if err := http.ListenAndServe(":"+port, r); err != nil {
        log.Fatal(err)
    }
}
```

### 4. `internal/api/health.go`

Match the existing TypeScript response shape:
```json
{ "status": "ok", "version": "<VERSION env var or 'dev'>" }
```

No auth required. If a shutdown flag is set (Group 8 adds this), return 503 instead.

### 5. `.golangci.yml`

Minimal but useful linter config:
```yaml
linters:
  enable:
    - gofmt
    - govet
    - errcheck
    - staticcheck
    - unused
linters-settings:
  gofmt:
    simplify: true
run:
  timeout: 5m
```

### 6. Dockerfile update

Add a Go build stage before the existing runner stage. Build the binary but do NOT change the CMD yet:

```dockerfile
FROM golang:1.23-alpine AS go-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /rollhook ./cmd/rollhook

# ... existing tool-downloader stage ...

FROM oven/bun:1.3.9-slim AS runner
# ... existing content ...
COPY --from=go-builder /rollhook /usr/local/bin/rollhook-go
# CMD stays as Bun server for now — switched in Group 8
```

The Go binary lands at `/usr/local/bin/rollhook-go` in the image, ready but not yet active.

---

## Validation

```bash
go build ./...
go vet ./...
go test ./...

# Manual check — start the Go server directly (not in Docker):
ROLLHOOK_SECRET=test-secret go run ./cmd/rollhook
curl http://localhost:7700/health
# Expected: {"status":"ok","version":"dev"}

# Missing secret should fail:
go run ./cmd/rollhook 2>&1 | grep -i "must be set"

# Docker image still builds:
docker build -t rollhook-test:latest -f apps/server/Dockerfile .
```

---

## Commit

```
feat(server): initialize Go module and project skeleton
```

---

## Done

Append learning notes to `docs/go-rewrite/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 1
```
