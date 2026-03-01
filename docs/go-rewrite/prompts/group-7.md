# Group 7: Pull Step + Rolling Deploy + Notifier

## What You're Doing

Complete the deploy pipeline: image pull (using the Docker SDK with streaming log output), rolling deploy (scale-up via docker compose subprocess, health polling via Docker SDK, drain old containers), and notifications (Pushover + webhook). After this group, a full deploy job can run end-to-end — queue to notification.

---

## Research & Exploration First

1. Read `apps/server/src/jobs/steps/pull.ts` — understand the X-Registry-Auth injection logic, the localhost detection, and how log output is handled
2. Read `apps/server/src/jobs/steps/rollout.ts` carefully — this is the most complex step:
   - The `--env-file <tmpfile>` pattern for IMAGE_TAG (read the comments explaining why — and note this entire approach is worth reconsidering in Go, see below)
   - The `oldIds.size === 0 ? 1 : oldIds.size * 2` first-deploy fix
   - The per-container health timeout (each container gets its own deadline)
   - The 10-retry poll after scale-up for Docker API propagation delay
   - The rollback on health failure
3. Read `apps/server/src/jobs/notifier.ts` — Pushover API call and webhook POST
4. Understand the `.env` file problem: the TypeScript implementation reads the user's `.env`, merges IMAGE_TAG into a temp file, and passes `--env-file` to docker compose to avoid mutating the user's project. In Go, think carefully about whether there's a cleaner solution — see note below.

---

## The `.env` Problem — Think Before Implementing

The TypeScript `rollout.ts` reads the user's `.env` file, merges in `IMAGE_TAG`, writes a temp file, and passes `--env-file` to docker compose. This was necessary because Docker Compose auto-reads `.env` from the project directory.

In Go you have more options. **Research the docker compose `--env-file` flag behaviour and compose-go's env resolution** to understand if there's a cleaner way. Options:
1. Same pattern as TypeScript (read, merge, temp file, cleanup)
2. Use only `--env-file` with a temp file that ONLY contains IMAGE_TAG (not the rest of `.env`) — compose still reads `.env` for other vars, and `--env-file` overrides IMAGE_TAG specifically
3. Use compose-go to parse the file first, check if IMAGE_TAG is actually referenced, and only inject it if needed

Whatever you choose, document the decision and tradeoffs in the learning notes. **The constraint is firm: never modify the user's `.env` file.**

---

## What to Implement

### 1. `internal/jobs/steps/pull.go`

```go
func Pull(ctx context.Context, cli *docker.Client, imageTag, secret string, logFn func(string)) error
```

- Call `docker.PullImage` (implemented in Group 4)
- X-Registry-Auth injected for localhost registries (uses `secret` as the password)
- Log high-signal events only (already filtered in Group 4's `PullImage`)

### 2. `internal/jobs/steps/rollout.go`

```go
func Rollout(ctx context.Context, cli *docker.Client, composePath, service, project, imageTag string, logFn func(string)) error
```

Algorithm:
1. Capture `oldContainers` via `docker.ListServiceContainers(project, service)`
2. Calculate `scaleCount`: `if len(oldContainers) == 0 { 1 } else { len(oldContainers) * 2 }`
3. Run `docker compose -f <composePath> --env-file <tmpfile> up -d --no-recreate --scale <service>=<scaleCount>`
   - Temp env file: resolve IMAGE_TAG injection cleanly (see research note above)
   - Use `os/exec`, capture stdout/stderr, log them
4. Poll for new containers: `findNewContainers` with 10x 500ms retries (Docker API propagation delay)
5. Health check each new container with its own per-container deadline (`ROLLHOOK_HEALTH_TIMEOUT_MS` env, default 60s):
   - `InspectContainer` → `State.Health.Status`
   - `"healthy"` → proceed
   - `"unhealthy"` → rollback + return error
   - No healthcheck defined → return error (require healthcheck for zero-downtime)
   - Timeout exceeded → rollback + return error
6. On all new containers healthy: stop + remove old containers
7. On any failure: rollback (stop + remove new containers), return error

### 3. `internal/notifier/notifier.go`

```go
type Config struct {
    PushoverUserKey  string // PUSHOVER_USER_KEY env
    PushoverAppToken string // PUSHOVER_APP_TOKEN env
    WebhookURL       string // NOTIFICATION_WEBHOOK_URL env
}

func Notify(ctx context.Context, cfg Config, job db.Job) error
// Send Pushover notification if both keys set
// POST job result JSON to WebhookURL if set
// Errors are logged but not fatal — notification failure does not fail the deploy
```

### 4. Complete `internal/jobs/executor.go`

Wire in the new steps. The full run flow:
```
UpdateStatus(running)
discover → UpdateDiscovery(composePath, service)
validate
pull → log each event
rollout → log each event
UpdateStatus(success)
notify (non-fatal if fails)
```

On any step error:
```
UpdateStatus(failed, err.Error())
notify (non-fatal)
```

---

## Validation

```bash
go test ./internal/jobs/...
go test ./internal/notifier/...
```

Tests:
- `TestRollout_FirstDeploy` — mock Docker SDK, verify scaleCount = 1 when no old containers
- `TestRollout_NormalDeploy` — 1 old container → scaleCount = 2
- `TestNotifier_Pushover` — mock http.Client, verify correct API call
- `TestNotifier_Webhook` — verify job JSON posted to webhook URL
- `TestNotifier_NotCalledWhenUnconfigured` — no env vars → no HTTP calls
- `TestPull_XRegistryAuth_Localhost` — verify auth injected for localhost:7700/image
- `TestPull_NoXRegistryAuth_External` — verify no auth for registry.example.com/image

```bash
go build ./...
go vet ./...
```

---

## Commit

```
feat(server): implement pull, rolling deploy, and notification pipeline
```

---

## Done

Append learning notes to `docs/go-rewrite/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 7
```
