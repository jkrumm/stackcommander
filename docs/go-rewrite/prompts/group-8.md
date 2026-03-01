# Group 8: Full API Surface + Wire-Up

## What You're Doing

Implement all HTTP handlers with full huma type definitions, wire every component together in `main.go`, and validate the Go server works correctly in isolation — without yet killing the Bun server or running E2E. By the end of this group, `go run ./cmd/rollhook` is a fully functional deployment server you can test with curl.

---

## Research & Exploration First

1. Read ALL of `apps/server/src/api/` — every handler file. Understand exact request/response shapes, field names, error response formats. These are the contract the E2E tests (Group 9) will verify.
2. Read `apps/server/src/api/jobs.ts` SSE implementation carefully — understand the streaming format, when `[DONE]` is sent, how it polls while the job is running vs terminal.
3. Read `apps/server/src/state.ts` — understand the shutdown flag pattern (503 on /health during drain).
4. Read `e2e/setup/fixtures.ts` — see `pollJobUntilDone` and how it uses the job API, to understand expected polling behaviour.
5. Check `packages/rollhook/src/types.ts` — verify the exact JSON field names on JobResult (this is what orval and the dashboard consume).

---

## What to Implement

### 1. `internal/api/deploy.go`

```
POST /deploy
Auth: required
Request:  { "image_tag": string }
Response: { "job_id": string, "app": string, "status": "queued" }
Errors:   400 if image_tag empty or missing
```

App name derived from image_tag: take the last path segment before the colon.
Examples:
- `localhost:7700/myapp:v2` → `myapp`
- `ghcr.io/user/myapp:sha-abc123` → `myapp`
- `myapp:latest` → `myapp`

Generate job ID with `crypto/rand` UUID or a simple `fmt.Sprintf("%x", rand.Int63())`. Check what format the TypeScript server uses (read `apps/server/src/api/deploy.ts`) and match it — the E2E tests may assert on ID format.

### 2. `internal/api/jobs.go`

**`GET /jobs`** (auth required):
```
Query params: app (string), status (string), limit (int, default 50)
Response: { "jobs": [...] }
```
All query params optional — omitted means no filter.

**`GET /jobs/{id}`** (auth required):
```
Response: Job object
Errors:   404 if not found
```

**`GET /jobs/{id}/logs`** (auth required) — SSE:
```
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no   ← prevents nginx/Traefik from buffering the stream

Format: data: <line>\n\n
Terminator: data: [DONE]\n\n  (when job reaches terminal status + all lines sent)
```

SSE implementation pattern:
1. Check job exists — 404 if not
2. Open log file (may not exist yet if job just queued — wait briefly)
3. Read line by line, sending `data: <line>\n\n` for each
4. After reaching EOF: check job status
   - If still running/queued: sleep 100ms, loop back to read more
   - If success/failed: send `data: [DONE]\n\n`, close stream
5. Flush after each write — `http.Flusher` interface

This is `http.Flusher` territory, not huma typed responses. Use a raw `http.HandlerFunc` for the SSE endpoint and register it directly on Chi (not through huma) to avoid huma's response wrapping interfering with the stream.

### 3. `internal/state/state.go`

```go
package state

var shuttingDown atomic.Bool

func StartShutdown()   { shuttingDown.Store(true) }
func IsShuttingDown() bool { return shuttingDown.Load() }
```

Update `/health` to return 503 when `IsShuttingDown()`.

### 4. `cmd/rollhook/main.go` — full wiring

```go
func main() {
    // Startup
    secret := mustGetSecret()       // validate ROLLHOOK_SECRET ≥ 7 chars
    dataDir := dataDirectory()      // "data" relative to CWD, or DATA_DIR env
    db := mustOpenDB(dataDir)
    dockerClient := mustNewDockerClient()
    registry := registry.NewManager(dataDir, secret)
    if err := registry.Start(ctx); err != nil { log.Fatal(err) }
    queue := jobs.NewQueue()
    executor := jobs.NewExecutor(db, dockerClient, queue, secret, dataDir)

    // Router
    r := chi.NewRouter()
    r.Use(middleware.Logger)        // slog-based request logging
    r.Get("/health", api.HealthHandler(state.IsShuttingDown))
    r.Get("/openapi", scalarHandler)
    r.Handle("/v2", registry.Proxy())
    r.Handle("/v2/", registry.Proxy())
    r.Handle("/v2/*", registry.Proxy())

    // Protected routes
    auth := middleware.RequireAuth(secret)
    r.With(auth).Post("/deploy", api.DeployHandler(db, executor))
    r.With(auth).Get("/jobs", api.ListJobsHandler(db))
    r.With(auth).Get("/jobs/{id}", api.GetJobHandler(db))
    r.With(auth).Get("/jobs/{id}/logs", api.StreamLogsHandler(db, dataDir))

    // huma OpenAPI (protected stub routes already registered in Group 2 — update them)

    // HTTP server + SIGTERM
    srv := &http.Server{Addr: ":" + port, Handler: r}
    go srv.ListenAndServe()

    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
    <-sig

    state.StartShutdown()                    // /health → 503
    time.Sleep(3 * time.Second)              // Traefik deregisters
    queue.Drain(5 * time.Minute)             // in-flight job completes
    registry.Stop()
    srv.Shutdown(context.Background())
}
```

---

## Validation

No E2E in this group. Validate with Go tests + curl smoke tests.

```bash
go build ./...
go vet ./...
go test ./...
```

Then start the server manually and curl every endpoint:

```bash
ROLLHOOK_SECRET=test-secret-7 go run ./cmd/rollhook &
sleep 2

# Health
curl -s http://localhost:7700/health | jq .
# → {"status":"ok","version":"dev"}

# Auth enforced
curl -s http://localhost:7700/jobs | jq .error
# → "unauthorized"

# Auth works
curl -s -H "Authorization: Bearer test-secret-7" http://localhost:7700/jobs | jq .
# → {"jobs":[]}

# Deploy enqueues
curl -s -X POST http://localhost:7700/deploy \
  -H "Authorization: Bearer test-secret-7" \
  -H "Content-Type: application/json" \
  -d '{"image_tag":"localhost:7700/smoke-test:v1"}' | jq .
# → {"job_id":"...","app":"smoke-test","status":"queued"}

# Scalar renders
curl -s http://localhost:7700/openapi | grep -i scalar

kill %1
```

---

## Commit

```
feat(server): implement full Go HTTP API surface and wire all components
```

---

## Done

Append learning notes to `docs/go-rewrite/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 8
```
