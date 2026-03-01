# Go Rewrite — Task Checklist

Legend: ⬜ pending | 🔄 in-progress | ✅ complete | 🚫 blocked

---

## Group 1: Go Module + Skeleton
**Status:** ⬜ | **Validation:** `go build + go test` + Docker build
**Goal:** Go binary exists, `/health` returns 200, Dockerfile builds Go binary alongside Bun.

- [ ] 1.1 `go mod init` + `go get` all dependencies
- [ ] 1.2 Full directory skeleton (`cmd/`, `internal/**`)
- [ ] 1.3 `cmd/rollhook/main.go`: ROLLHOOK_SECRET validation + `/health` + Chi router
- [ ] 1.4 `internal/api/health.go`: `{ "status": "ok", "version": "..." }`
- [ ] 1.5 `.golangci.yml`: gofmt, govet, errcheck, staticcheck
- [ ] 1.6 Dockerfile: Go build stage, binary at `/usr/local/bin/rollhook-go` (CMD still Bun)
- [ ] 1.7 `go test ./...` passes, `go build ./...` clean, Docker image builds

---

## Group 2: Auth + OpenAPI + Scalar
**Status:** ⬜ | **Validation:** `go test ./internal/middleware/...` + curl smoke
**Goal:** 401 on protected routes, Scalar renders at `/openapi`, spec at `/openapi.json`.

- [ ] 2.1 `internal/middleware/auth.go`: Bearer token middleware
- [ ] 2.2 huma v2 + Chi adapter in `main.go`
- [ ] 2.3 Bearer security scheme on all protected operations
- [ ] 2.4 Scalar HTML at `/openapi`
- [ ] 2.5 Stub protected routes (501 body, correct paths + auth)
- [ ] 2.6 Unit tests: no header → 401, wrong token → 401, correct token → pass through

---

## Group 3: SQLite + Job Persistence
**Status:** ⬜ | **Validation:** `go test ./internal/db/...`
**Goal:** Job CRUD working, log file helpers, in-memory tests.

- [ ] 3.1 `internal/db/client.go`: modernc.org/sqlite, WAL mode, migrations
- [ ] 3.2 `internal/db/jobs.go`: Insert, Get, List, UpdateStatus, UpdateDiscovery
- [ ] 3.3 Log path helpers: `LogPath`, `AppendLog`, `EnsureLogDir`
- [ ] 3.4 Tests: round-trip, filters, status transitions, nil-on-missing

---

## Group 4: Docker SDK Integration
**Status:** ⬜ | **Validation:** `go test ./internal/docker/...`
**Goal:** All container ops via SDK, streaming ImagePull, X-Registry-Auth for localhost.

- [ ] 4.1 `internal/docker/client.go`: SDK client from DOCKER_HOST or socket
- [ ] 4.2 `internal/docker/api.go`: ContainerList, Inspect, ImagePull (streaming), Stop, Remove
- [ ] 4.3 X-Registry-Auth injection for localhost registries
- [ ] 4.4 Unit tests for helpers + integration tests (skip if Docker unavailable)

---

## Group 5: Zot Manager + OCI Proxy
**Status:** ⬜ | **Validation:** `go test ./internal/registry/...` + manual push/pull
**Goal:** Zot starts, `/v2/` returns 401, push/pull works through proxy with native streaming.

- [ ] 5.1 `internal/registry/config.go`: Zot JSON config + htpasswd (bcrypt, `compat: ["docker2s2"]`)
- [ ] 5.2 `internal/registry/manager.go`: os/exec spawn, health poll, line-buffered log pipe, stop
- [ ] 5.3 `internal/registry/proxy.go`: httputil.ReverseProxy + auth + Location rewrite
- [ ] 5.4 Register `/v2/*` in main.go
- [ ] 5.5 chmod 0600 on .htpasswd and config.json
- [ ] 5.6 Unit tests: config structure, compat mode, auth validation, htpasswd format

---

## Group 6: Job Queue + Discovery + Validation
**Status:** ⬜ | **Validation:** `go test ./internal/jobs/...`
**Goal:** FIFO queue, compose label discovery, compose-go file validation.

- [ ] 6.1 `internal/jobs/queue.go`: channel-based FIFO, sequential, `Drain`
- [ ] 6.2 `internal/jobs/executor.go`: skeleton, discover + validate steps wired
- [ ] 6.3 `internal/jobs/steps/discover.go`: Docker SDK labels → compose_path + service
- [ ] 6.4 `internal/jobs/steps/validate.go`: compose-go parse, service + image check
- [ ] 6.5 Tests: queue FIFO/sequential, discover (integration), validate (unit)

---

## Group 7: Pull + Rolling Deploy + Notifier
**Status:** ⬜ | **Validation:** `go test ./internal/jobs/...` + `go test ./internal/notifier/...`
**Goal:** Complete deploy pipeline end-to-end.

- [ ] 7.1 `internal/jobs/steps/pull.go`: Docker SDK pull, streaming logs, X-Registry-Auth
- [ ] 7.2 `internal/jobs/steps/rollout.go`: scale-up, per-container health poll, drain, rollback
- [ ] 7.3 Temp env file for IMAGE_TAG (never mutate user's .env)
- [ ] 7.4 `internal/notifier/notifier.go`: Pushover + webhook, non-fatal errors
- [ ] 7.5 Complete `executor.go`: full discover→validate→pull→rollout→notify flow
- [ ] 7.6 Tests: rollout scale logic, notifier mock, pull X-Registry-Auth

---

## Group 8: Full API + Wire-Up
**Status:** ⬜ | **Validation:** `go build + go test` + curl smoke test
**Goal:** All HTTP handlers implemented, all components wired in main.go. `go run ./cmd/rollhook` is a fully functional server testable with curl.

- [ ] 8.1 `internal/api/deploy.go`: POST /deploy with huma types
- [ ] 8.2 `internal/api/jobs.go`: GET /jobs, GET /jobs/{id}, GET /jobs/{id}/logs (SSE via http.Flusher)
- [ ] 8.3 `internal/state/state.go`: shutdown flag for graceful 503 on /health
- [ ] 8.4 `cmd/rollhook/main.go`: full wiring — DB, Docker, registry, queue, executor, router, SIGTERM handler
- [ ] 8.5 Curl smoke test: health, auth, deploy enqueue, Scalar renders

---

## Group 9: Dockerfile Cutover + E2E Quality Pass
**Status:** ⬜ | **Validation:** `bun run test:e2e` — all pass
**Goal:** Go binary is the server. Bun server deleted. E2E suite used as quality signal — fix Go or improve tests as appropriate. Document all deviations.

- [ ] 9.1 Dockerfile: switch CMD to Go binary, remove Bun runtime, switch base image to debian:12-slim or alpine
- [ ] 9.2 `rm -rf apps/server/`
- [ ] 9.3 Run E2E file-by-file: health → auth → registry-proxy → deploy → failure → jobs → queue → zero-downtime
- [ ] 9.4 Triage each failure: fix Go if wrong, update test if testing TS quirk (not contract)
- [ ] 9.5 Full suite: all tests pass
- [ ] 9.6 RALPH_NOTES: document every test that was fixed or updated and why

---

## Group 10: OpenAPI Polish + Orval + Cleanup
**Status:** ⬜ | **Validation:** `bun run generate:api` + `bun run typecheck --cwd apps/dashboard`
**Goal:** Dashboard has generated typed hooks. Docs updated. Clean slate.

- [ ] 10.1 Complete huma operation definitions (summaries, descriptions, tags, error responses)
- [ ] 10.2 SSE endpoint documented in spec
- [ ] 10.3 `apps/dashboard/orval.config.ts` + `src/api/client.ts`
- [ ] 10.4 `bun run generate:api` script, baseline types committed
- [ ] 10.5 `CLAUDE.md` updated (Go patterns, remove Elysia gotchas)
- [ ] 10.6 `README.md` updated
- [ ] 10.7 Final cleanup: .gitignore, root package.json scripts, stale references
