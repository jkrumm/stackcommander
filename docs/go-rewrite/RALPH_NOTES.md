# RollHook Go Rewrite — RALPH Notes

Implementation notes, gotchas, security observations, and future improvements captured after each group.

---

<!-- Claude appends a ## Group N section after completing each group -->

## Group 1: Go Module + Project Skeleton

### What was implemented
Initialized `github.com/jkrumm/rollhook` Go module at repo root with all required dependency declarations, created the full `internal/` directory skeleton with placeholder package files, implemented `cmd/rollhook/main.go` with `ROLLHOOK_SECRET` validation + chi router + `/health` endpoint, and confirmed the Dockerfile Go build stage (binary at `/usr/local/bin/rollhook-go`, CMD stays Bun). Fixed a Content-Type header ordering bug in health.go.

### Deviations from prompt
- **Go bumped to 1.24.1** (not 1.23): huma/v2 v2.36, sqlite v1.46, compose-go/v2 v2.10, x/crypto v0.48 all require go ≥ 1.24. Staying at 1.23 would require very old package versions with known bugs. 1.24.1 is the minimum that satisfies all deps cleanly.
- **Dockerfile FROM updated to `golang:1.24-alpine`** to match go.mod directive.
- **Library versions pinned** due to go version constraints: `huma/v2@v2.36.0` (v2.37+ requires 1.25), `go-containerregistry@v0.20.6` (v0.20.8+ requires 1.25.6).
- **`github.com/docker/docker@v28.5.2+incompatible`** used for Docker client. `github.com/docker/docker/client` is a sub-package of the main docker module, not its own module — attempting `go get github.com/docker/docker/client` resolves to the renamed `github.com/moby/moby/client` (wrong).
- **Fixed Content-Type header ordering bug**: original code called `w.WriteHeader(503)` before `w.Header().Set("Content-Type", ...)` on the shutting-down path. In Go's net/http, headers must be set before `WriteHeader` — otherwise they are silently dropped.

### Gotchas & surprises
- `google/go-containerregistry` jumped its minimum Go from 1.24.0 (v0.20.6) to 1.25.6 in v0.20.8 — a surprising jump within the same minor series. Pin carefully in future.
- `go get github.com/docker/docker/client` (treating it as a module path) produces a confusing error: "module declares its path as: github.com/moby/moby/client". The correct approach: `go get github.com/docker/docker` and use `github.com/docker/docker/client` as an import path.
- Go is not natively installed on the dev machine — all `go` commands run via `docker run --rm -v $PWD:/workspace -w /workspace golang:1.24-alpine`.
- GOTOOLCHAIN=local with mismatched versions produces hard errors. Use GOTOOLCHAIN=auto or ensure go.mod matches deps' minimum.

### Security notes
- `ROLLHOOK_SECRET` check happens before any network listener opens — process exits before binding port 7700 if misconfigured.
- Binary compiled with `-ldflags="-w -s"` (strip debug/symbol info) and `CGO_ENABLED=0` (fully static, no shared lib deps).

### Tests added
None — no business logic yet. `go test ./...` reports `[no test files]` across all packages as expected at skeleton stage.

### Future improvements
- The `// indirect` markers on most deps in go.mod will resolve naturally when packages are imported in later groups and `go mod tidy` is run.
- `golangci-lint` not verified locally (not installed); will be enforced in CI once GitHub Actions are configured.
- Consider pinning `golang:1.24-alpine` to a specific digest in the Dockerfile for reproducible builds.

---

## Group 2: Auth Middleware + OpenAPI + Scalar

### What was implemented
Bearer token auth middleware, huma v2 + Chi wiring with OpenAPI 3.1 spec at `/openapi.json`, Scalar UI at `/openapi`, and stub huma operations for all planned routes (deploy, jobs) returning 501.

### Deviations from prompt
- **Auth enforcement via huma middleware, not chi subrouter**: The prompt shows `RequireAuth` as a standard chi middleware but doesn't specify how it connects to huma operations. Using `api.UseMiddleware()` with a check on `ctx.Operation().Security` is cleaner than path-based chi middleware exemptions and works naturally with huma's operation model. `RequireAuth` stays as a standalone chi middleware for unit testing.
- **`strings.CutPrefix` instead of `strings.TrimPrefix`**: `TrimPrefix` doesn't reject requests where the `Bearer ` prefix is absent — the raw secret would pass as a valid token. `CutPrefix` (Go 1.20+) returns `(after, found bool)`, allowing explicit rejection when the prefix is missing. Same fix applied in both auth.go and main.go.
- **`/openapi` route registered on chi root**: huma's default SpecPath="/openapi" only registers `/openapi.json` and `/openapi.yaml` (not the base `/openapi` path), so there is no route conflict with the custom Scalar handler registered at `/openapi`.

### Gotchas & surprises
- `strings.TrimPrefix("no-prefix-here", "Bearer ")` returns `"no-prefix-here"` unchanged — this silently authenticates requests that omit `Bearer `. Always use `CutPrefix` for prefix-based parsing where absence matters.
- huma's `DefaultConfig` sets `DocsPath = "/docs"` (SwaggerUI) and `SpecPath = "/openapi"` (serving `.json`/`.yaml` variants). Setting `DocsPath = ""` disables the default SwaggerUI without affecting the spec endpoints.
- huma middleware closure capturing `api` is safe: the variable is assigned before `UseMiddleware` is called, and main() never returns, so the variable's lifetime exceeds all request handling.
- huma's `huma.NewError(status, msg)` is the generic error constructor — specific helpers like `Error404NotFound` exist but 501 has no dedicated helper.

### Security notes
- Auth is enforced on any operation with a non-empty `Security` field — health and OpenAPI spec endpoints are public by omission, not by path-based allow-listing.
- `RequireAuth` chi middleware (used in tests) correctly rejects requests where the `Bearer ` prefix is absent, matching the TypeScript behavior of `authHeader.startsWith('Bearer ')`.

### Tests added
- `internal/middleware/auth_test.go`: 5 cases — no header, wrong token, correct token, missing Bearer prefix, empty bearer value.

### Future improvements
- The `/jobs/{id}/logs` SSE endpoint is a stub returning 501 via huma. In a later group, this will likely bypass huma and be a raw chi handler (huma has no native SSE support); the huma registration may be replaced with a chi-level SSE handler that also contributes to the spec via manual spec patching or a custom huma response type.
- `go mod tidy` should be run to clean up `// indirect` markers after all direct imports are finalized.

---

## Group 3: SQLite + Job Persistence

### What was implemented
`internal/db/client.go`: opens `data/rollhook.db` via modernc.org/sqlite, enables WAL mode, runs idempotent migrations using `PRAGMA table_info`. `internal/db/jobs.go`: `Job` struct, `JobStatus` constants, `Store` CRUD methods (Insert, Get, List, UpdateStatus, UpdateDiscovery), log file helpers (LogPath, AppendLog, EnsureLogDir). `internal/db/jobs_test.go`: 14 tests across 7 test functions covering all CRUD paths and log helpers.

### Deviations from prompt
- **`Store` struct instead of package-level functions**: the prompt sketched package-level functions (`Insert(job Job) error`), but a `Store` struct with a `*sql.DB` field is more idiomatic Go and makes dependency injection into handlers straightforward. No global state.
- **`sql.NullString` for nullable fields**: Go's `database/sql` requires explicit null handling; scanning nullable TEXT columns into `sql.NullString` then converting to `*string` is the correct pattern. The `*string` JSON tags in the `Job` struct match the TypeScript `JobResult` optional fields.

### Gotchas & surprises
- `modernc.org/sqlite` registers itself under the driver name `"sqlite"` (not `"sqlite3"` — that's `mattn/go-sqlite3`). Using the wrong name gives a `sql: unknown driver "sqlite3"` panic.
- WAL mode cannot be applied to an in-memory SQLite database (the journal is in-memory by definition). Tests bypass `Open()` and call `migrate()` directly after `sql.Open("sqlite", ":memory:")` — this skips the WAL pragma entirely, which is correct for unit tests.
- `PRAGMA table_info(jobs)` returns 6 columns per row: `cid`, `name`, `type`, `notnull`, `dflt_value`, `pk`. All 6 must be scanned; attempting to scan fewer columns yields a `sql: expected N destination arguments in Scan, not M` error.
- `time.RFC3339` round-trips correctly through SQLite TEXT. SQLite's `CURRENT_TIMESTAMP` default uses `"YYYY-MM-DD HH:MM:SS"` format, so `parseTime` handles multiple layouts to be robust against rows inserted by the TS server or SQLite defaults.

### Security notes
- Log files are created with mode `0o644` (owner read/write, group/other read) — appropriate for a single-user VPS. Log directory uses `0o755`.
- No SQL injection risk: all query parameters use `?` placeholders via `database/sql`.

### Tests added
- `internal/db/jobs_test.go`:
  - `TestInsertAndGet` — round-trip for all fields including nil optionals
  - `TestGetMissingReturnsNil` — confirms nil return (not error) for unknown ID
  - `TestUpdateStatusTransitions` — table-driven: queued→running→success and queued→running→failed with error message
  - `TestUpdateDiscovery` — compose_path + service set correctly
  - `TestListFilters` — subtests for no filter, app filter, status filter, combined filter, limit
  - `TestListOrderedNewestFirst` — newest job appears first
  - `TestLogHelpers` — EnsureLogDir, LogPath, AppendLog (content verification)

### Future improvements
- `Store` could be extended with a `DB() *sql.DB` accessor for raw queries in tests or migrations.
- Consider using `time.Now().UTC().Round(time.Second)` in Insert to avoid sub-second precision that varies between systems.
- A `Ping()` wrapper in `Open()` would catch open-but-unusable databases (e.g., permission errors that don't surface until first query).

---

## Group 4: Docker SDK Integration

### What was implemented
`internal/docker/client.go`: `NewClient()` wraps `client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())`. `internal/docker/api.go`: `ListRunningContainers`, `ListServiceContainers` (all states, label-filtered), `InspectContainer`, `StopContainer`, `RemoveContainer`, `PullImage` — all using the official Docker Go SDK. Pull streaming uses `bufio.Scanner` + NDJSON parsing with high-signal filter (same 5 prefixes as TypeScript). X-Registry-Auth injected for localhost registries via base64-encoded JSON credentials. `internal/docker/api_test.go`: 7 unit tests + 2 integration tests (auto-skipped if Docker unavailable).

### Deviations from prompt
- **`ListServiceContainers` uses `All: true`**: The prompt didn't specify, and the TypeScript default was running-only. Set `All: true` so rollout health polling can see newly scaled replicas in "created"/"starting" state before they become "running". Caller can filter by state if needed.
- **`buildRegistryAuth` uses `json.Marshal` + `base64.StdEncoding`** instead of `registry.EncodeAuthConfig`: avoids importing an additional sub-package; the JSON structure is identical and tested explicitly.
- **No `parseImageTag` helper**: The TypeScript split `fromImage`/`tag` because it called the Docker API directly with query params. The Go SDK's `ImagePull` takes a full reference string (e.g. `"image:tag"`) and splits internally — no manual splitting needed.

### Gotchas & surprises
- **Docker SDK v28 type names changed**: `ContainerList` returns `[]container.Summary` (not `[]types.Container`), `ContainerInspect` returns `container.InspectResponse` (not `types.ContainerJSON`). All options types moved to `github.com/docker/docker/api/types/container` and `github.com/docker/docker/api/types/image` sub-packages.
- **`errdefs` package**: `github.com/docker/docker/errdefs` provides `IsNotModified` (304) and `IsNotFound` (404) predicates for graceful handling of already-stopped/already-removed cases.
- **`go mod tidy` pulled in many transitive deps** from the Docker SDK (OpenTelemetry, gRPC, etc.) — these are indirect and don't affect the binary size materially since CGO_ENABLED=0 strips unused symbols.

### Security notes
- Registry credentials are never logged — only the X-Registry-Auth encoded header value is passed to the Docker daemon, not printed to stdout/logs.
- `buildRegistryAuth` encodes with `base64.StdEncoding` (not URL-safe encoding) — this matches the Docker daemon's expectation for the `X-Registry-Auth` header.

### Tests added
- `internal/docker/api_test.go`:
  - `TestIsLocalhost` — 8 cases: localhost:*, 127.0.0.1:*, external registries, no-host images
  - `TestExtractHost` — 6 cases: various image tag formats
  - `TestBuildRegistryAuth` — verifies base64+JSON round-trip with correct field names
  - `TestParsePullStream/forwards_high-signal_events_only` — 4 events pass, 2 filtered
  - `TestParsePullStream/already_exists_events_pass_through`
  - `TestParsePullStream/returns_error_on_pull_error_event`
  - `TestParsePullStream/skips_malformed_NDJSON_lines`
  - `TestParsePullStream/skips_blank_lines`
  - `TestListRunningContainers_Integration` — auto-skips if Docker unavailable
  - `TestPullImage_Integration` — pulls hello-world:latest, verifies at least one log line

### Future improvements
- `ListServiceContainers` could accept a `running bool` parameter to switch between `All: true`/`false` when the rollout step's needs are clearer.
- The `bufio.Scanner` default buffer (64KB) is sufficient for all known NDJSON pull events; no need to increase unless very large layer digests appear.

---

## Group 5: Zot Process Manager + Streaming OCI Proxy

### What was implemented
`internal/registry/config.go`: typed structs for Zot JSON config generation (deterministic key order), bcrypt htpasswd generation at cost 12 via `golang.org/x/crypto/bcrypt`. `internal/registry/manager.go`: `Manager` struct that writes config/htpasswd, launches `zot serve` as a child process, pipes stdout/stderr line-by-line via `bufio.Scanner`, and polls `/v2/` until ready. Single watcher goroutine owns `cmd.Wait()` — `Stop()` sends SIGTERM and waits on a `done` channel. `internal/registry/proxy.go`: `validateProxyAuth` supporting Bearer + Basic (any username), `NewProxy` returning an `httputil.ReverseProxy`-backed handler with hop-by-hop header stripping, Zot Basic auth injection, and Location header rewriting. `cmd/rollhook/main.go` updated: registry manager started before HTTP listener, `/v2` + `/v2/` + `/v2/*` chi routes wired, graceful shutdown via `signal.NotifyContext` + `srv.Shutdown`.

### Deviations from prompt
- **Typed structs for config** instead of `map[string]any`: gives deterministic JSON key ordering (cleaner config file) and documents the schema in code. `json.MarshalIndent` on a struct vs a map produces the same valid output but with stable ordering.
- **`golang.org/x/crypto` added as direct dependency** at v0.48.0 (latest compatible with go 1.24.1). It was previously in go.sum only as an indirect transitive dep.
- **`DATA_DIR` env var** added to `main.go` for the data directory (defaults to `"data"`). Mirrors what the manager needs; avoids hardcoding `"data"` in both places.
- **`signal.NotifyContext` + `srv.Shutdown` in main.go** instead of `http.ListenAndServe`: implements graceful shutdown so the HTTP server drains in-flight requests and the registry manager is stopped cleanly on SIGTERM/SIGINT.

### Gotchas & surprises
- **`cmd.Wait()` may only be called once**: if both the watcher goroutine and `Stop()` each call `Wait()`, the second call returns an error ("waitid: no child processes"). Solution: single watcher goroutine owns `Wait()`; `Stop()` sends SIGTERM and blocks on a `done` channel that the watcher closes.
- **`httputil.ReverseProxy` already strips most hop-by-hop headers** (Connection, Keep-Alive, TE, Trailers, Transfer-Encoding, Upgrade) since Go 1.17. Explicitly stripping them in `Director` is redundant but harmless and matches the TypeScript proxy exactly.
- **`originalDirector` capture**: overriding `proxy.Director` after calling `httputil.NewSingleHostReverseProxy` requires capturing the original director first and calling it in the new director. Forgetting this means the request URL is never rewritten to the target host.
- **`exec.CommandContext` avoided**: using the context to kill Zot gives no opportunity for graceful SIGTERM → wait → SIGKILL sequence. Using `exec.Command` and managing the lifecycle manually in `Stop()` gives full control.

### Security notes
- `config.json` and `.htpasswd` written with mode `0o600` (owner read/write only) — no world-readable credentials.
- `registry/` data directory created with `0o755` — Zot process (same user) can read/write blobs.
- Zot binds `127.0.0.1:5000` exclusively — not reachable from outside the container.
- `validateProxyAuth` uses `strings.CutPrefix` for both Bearer and Basic — rejects requests where the scheme prefix is absent (same protection as auth middleware Groups 1–2).
- `writeUnauthorized` returns the OCI distribution spec error body format so Docker CLI shows a meaningful error instead of a generic 401.

### Tests added
- `internal/registry/config_test.go`: `TestGenerateZotConfig_ContainsDockerCompat`, `TestGenerateZotConfig_LoopbackAddress`, `TestGenerateZotConfig_PortAsString`, `TestGenerateHtpasswd_Format`, `TestGenerateHtpasswd_VerifiesCorrectly` (5 tests)
- `internal/registry/proxy_test.go`: `TestValidateProxyAuth_Bearer`, `TestValidateProxyAuth_Basic_AnyUsername` (4 username variants), `TestValidateProxyAuth_InvalidToken` (4 subtypes), `TestValidateProxyAuth_Missing` (4 tests)
- Total registry tests: 9/9 pass. Full suite: 32/32 pass.

### Future improvements
- Manager integration test (requires Zot binary in PATH): start manager, hit `/v2/`, verify 401, stop manager. Currently only unit tests.
- `DataDir` could be exposed as a field or method on `Manager` so callers don't need to track it separately.
- Consider a `Manager.Addr()` method returning `"http://127.0.0.1:5000"` so `main.go` doesn't hardcode the port.

---

## Group 6: Job Queue, Service Discovery, and Compose Validation

### What was implemented
FIFO channel-based job queue (`internal/jobs/queue.go`), service discovery via Docker label inspection (`internal/jobs/steps/discover.go`), compose file validation using compose-go v2 (`internal/jobs/steps/validate.go`), and the executor skeleton that ties them together (`internal/jobs/executor.go`).

### Deviations from prompt
- Exported `FindMatchingContainer` and `ExtractComposeInfo` (alongside the already-exported `ExtractImageName`) to enable clean black-box tests from `package steps_test` — mirrors the TypeScript source which explicitly exports these helpers "for unit testing".
- Added `NewJob()` helper on the executor package to create a `db.Job` with a UUID and timestamps — keeps job creation logic in one place rather than scattered across API handlers.
- Added `TestQueue_DrainNoopsAfterFirst` and `TestQueue_EnqueueAfterDrainIsNoOp` beyond the three tests in the prompt, covering idempotency and panic-safety of the Drain + Enqueue interaction.

### Gotchas & surprises
- `cli.WithSkipValidation` does not exist in the `cli` package. The option lives on `loader.Options.SkipValidation` and must be threaded in via `cli.WithLoadOptions(func(o *loader.Options) { o.SkipValidation = true })`.
- compose-go v2 (v2.10.1) brought in several transitive dependencies (`go.yaml.in/yaml`, `santhosh-tekuri/jsonschema`, `go-viper/mapstructure`, etc.) — worth noting for image size budgets.
- `go mod tidy` was required after `go get github.com/compose-spec/compose-go/v2` before `go build` would succeed (indirect deps needed updating in `go.sum`).

### Security notes
- No sensitive data flows through the queue or executor beyond the `ROLLHOOK_SECRET` held by the Executor for registry auth (used in Group 7's pull step).
- `cli.WithOsEnv` in validate loads the process's full OS environment into compose interpolation. This is correct (matches how `docker compose` behaves) but means any secret env vars could be interpolated into compose file variables if there's a naming collision. This is a pre-existing Docker Compose behaviour, not introduced here.

### Tests added
- `internal/jobs/queue_test.go`: `TestQueue_FIFO`, `TestQueue_Sequential`, `TestQueue_Drain`, `TestQueue_DrainNoopsAfterFirst`, `TestQueue_EnqueueAfterDrainIsNoOp`
- `internal/jobs/steps/discover_test.go`: `TestExtractImageName` (7 cases), `TestFindMatchingContainer` (5 cases), `TestExtractComposeInfo_Success`, `TestExtractComposeInfo_NilLabels`, `TestExtractComposeInfo_MissingConfigFiles`, `TestExtractComposeInfo_MissingService`
- `internal/jobs/steps/validate_test.go`: `TestValidate_RelativePath`, `TestValidate_MissingFile`, `TestValidate_ServiceNotFound`, `TestValidate_Success`, `TestValidate_BuildOnlyService`, `TestValidate_ImageMismatch`
- Total new tests: 18. Full suite: 50/50 pass.

### Future improvements
- Integration test for `Discover` (requires a labelled Docker container) — skipped for now; covered by E2E tests instead.
- The executor's `execute` method passes `context.Background()` — once pull/rollout are added in Group 7, a cancellable context should be threaded from the queue worker so a SIGTERM can interrupt in-flight pulls.

---

## Group 7: Pull Step + Rolling Deploy + Notifier

### What was implemented
`internal/jobs/steps/pull.go`: thin wrapper around `docker.PullImage` with consistent `[pull]` log prefixes. `internal/jobs/steps/rollout.go`: full zero-downtime rolling deploy — scale-up via `docker compose` subprocess, per-container health polling with individual deadlines, rollback on failure, old container drain. `internal/notifier/notifier.go`: Pushover and webhook notifications, non-fatal on error. `internal/jobs/executor.go` updated: pull + rollout + notify wired into the full deploy pipeline.

### Deviations from prompt
- **`rollbackContainers` uses `context.Background()`**: rollback is cleanup after failure, so it must complete even if the parent context is cancelled (e.g. timeout). Using the parent ctx would abort cleanup if the context that triggered the rollback was already done.
- **`exec.CommandContext(ctx, ...)` for docker compose**: unlike the Zot manager (which needs graceful SIGTERM handling), the compose subprocess being killed mid-scale just means old containers remain running — a safe state. Using `exec.CommandContext` lets a future cancellable context interrupt a hung scale-up.
- **No separate `pull_test.go`**: `PullImage` auth injection is already fully covered in `internal/docker/api_test.go` (`TestIsLocalhost`, `TestBuildRegistryAuth`). The `Pull` wrapper itself has no logic beyond delegation, so a separate test file would only duplicate those tests. Integration coverage is provided by E2E tests.

### .env Problem Decision
**Chosen approach: read+merge** (same as TypeScript). Docker Compose v2 `--env-file` fully replaces the auto-loaded `.env` — it does not merge. Passing a temp file with only `IMAGE_TAG=<tag>` would silently drop all other user variables. The correct solution is: read user's `.env`, merge `IMAGE_TAG` into it via `setEnvLine`, write temp file. The temp file is cleaned up in a deferred `os.Remove`. The user's `.env` is never touched. `setEnvLine` replaces the last occurrence of the key (matching TypeScript's `findLastIndex` behaviour) to handle the edge case of duplicate keys.

### Gotchas & surprises
- **`os.IsNotExist` vs `errors.Is(err, fs.ErrNotExist)`**: both work in Go 1.24; `os.IsNotExist` is the traditional form and still idiomatic for filesystem operations.
- **`container.Summary.ID` field**: confirmed uppercase `ID` (not `Id`) — Docker SDK v28 naming. Consistent with `api.go` usage.
- **`go vet` clean on package-level vars in notifier**: `httpClient` and `pushoverEndpoint` package-level vars draw a `gochecknoglobals` lint comment if golangci-lint is configured; suppressed with `//nolint:gochecknoglobals`. This is the canonical Go pattern for injecting test doubles into functions with a fixed signature.
- **`httptest.NewServer` for notifier tests**: no mock framework needed. Standard library `httptest.NewServer` captures real HTTP requests, allowing inspection of body, headers, and method without any mocking infrastructure.

### Security notes
- Notification config is read from env at job execution time (not stored in the Executor struct) — avoids persisting sensitive values in heap-allocated structs for the lifetime of the server.
- `pushoverEndpoint` override is only accessible from `package notifier` — the package-level var is unexported, so tests must live in the same package. This prevents callers from accidentally overriding the endpoint in production code.

### Tests added
- `internal/jobs/steps/rollout_test.go`: `TestScaleTarget` (4 cases), `TestSetEnvLine` (6 table cases), `TestEnvInt_Default`, `TestEnvInt_Set`
- `internal/notifier/notifier_test.go`: `TestNotifier_Webhook`, `TestNotifier_Pushover`, `TestNotifier_Pushover_FailureTitle`, `TestNotifier_NotCalledWhenUnconfigured`, `TestNotifier_WebhookError_DoesNotPanic`
- Full suite: all packages pass. Previous 50 tests + 13 new = 63 tests.

### Future improvements
- Thread a cancellable context from the queue worker into `execute()` so SIGTERM can interrupt in-flight pulls/rollouts.
- `TestRollout_FirstDeploy` / `TestRollout_NormalDeploy` as integration tests (require Docker + docker compose in PATH) — scale count behaviour is currently covered by `TestScaleTarget` unit test.
- Notifier config could be passed as a constructor arg to `Executor` (injected at startup) rather than read from env at each job execution — would enable cleaner testing of the executor's notification path.

---

## Group 8: Full API Surface + Wire-Up

### What was implemented
Implemented all HTTP handlers with full logic (replacing 501 stubs): `POST /deploy` enqueues jobs, `GET /jobs`/`GET /jobs/{id}` query SQLite via `db.Store`, `GET /jobs/{id}/logs` streams SSE from the log file with `[DONE]` terminator. Wired all components (DB, Docker client, Executor) in `main.go`. Graceful shutdown follows the full sequence: `state.StartShutdown()` → 3s Traefik drain → `exec.Queue().Drain(5min)` → stop registry → `srv.Shutdown()`. Added 11 API unit tests covering all endpoints.

### Deviations from prompt
- **`RegisterJobs` renamed to `RegisterJobsAPI`** and the SSE huma stub removed — keeping a dead huma stub would cause chi route conflicts when adding the raw SSE handler on the same path.
- **`GET /jobs` wraps result in `{"jobs":[...]}`** matching the spec and dashboard `data.json` format. The TypeScript server returned a bare array; E2E tests will need adjustment in Group 9.
- **`GET /jobs/{id}` returns job object directly** (not wrapped) — matches `pollJobUntilDone()` which accesses `job.status` directly on the parsed response.
- **Curl smoke test skipped** — Zot binary not installed on dev machine; server fails at `mgr.Start()`. Validated via API unit tests instead.
- **`io.EOF` sentinel used** — `bufio.Reader.ReadString` on a file being appended returns `("partial", io.EOF)` at EOF; the partial buffer is preserved across retries since the reader's internal position doesn't reset.

### Gotchas & surprises
- **huma registers routes on the underlying chi router** — registering `/jobs/{id}/logs` directly on chi after huma registers `/jobs/{id}` is safe; chi's radix tree treats them as distinct routes (different path depth).
- **`bufio.Reader` tail-follow**: after `ReadString` returns `io.EOF` with a partial line, the partial string is returned but the reader's position doesn't reset. On the next iteration after sleeping 100ms, `ReadString` continues from where it left off. No seek required.
- **Async executor errors in tests** are benign: `Submit` returns synchronously after enqueuing, but the queue goroutine continues after `sqlDB.Close()`. The "sql: database is closed" log lines don't fail any tests.
- **huma validates `required:"true"` at schema layer** — missing `image_tag` yields 422 (schema validation), not the handler's explicit 400 guard. Both are acceptable per the spec.

### Security notes
- The SSE endpoint uses `middleware.RequireAuth(secret)` (chi middleware) not huma's security middleware, since it bypasses huma entirely. Both use `strings.CutPrefix` — no silent passthrough on missing `Bearer ` prefix.

### Tests added
- `internal/api/api_test.go` (11 tests):
  - `TestDeploy_MissingImageTag`, `TestDeploy_Valid`, `TestDeploy_Unauthorized`
  - `TestListJobs_Empty`, `TestListJobs_WithFilter`
  - `TestGetJob_NotFound`, `TestGetJob_Found`
  - `TestStreamLogs_NotFound`, `TestStreamLogs_TerminalJob`, `TestStreamLogs_Unauthorized`
  - `TestDeploy_AppNameExtraction` (table-driven, 3 cases)
- Full suite: 74 tests across all packages, all pass.

### Future improvements
- Smoke test once Zot is in dev PATH: `ROLLHOOK_SECRET=test-secret-7 go run ./cmd/rollhook &` then curl each endpoint.
- SSE handler could use `fsnotify` for more efficient tail-follow instead of 100ms polling.
- `newTestServer` rebuilds the full huma+chi stack per test — a shared suite-level fixture would be faster for large test runs.
