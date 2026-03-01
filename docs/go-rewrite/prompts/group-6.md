# Group 6: Job Queue + Discovery + Validation

## What You're Doing

Implement the FIFO job queue (Go channels, sequential execution) and the first two deploy pipeline steps: discover (find the running service via Docker label inspection) and validate (parse the compose file with compose-go, check the image is referenced). The executor skeleton ties them together.

---

## Research & Exploration First

1. Read `apps/server/src/jobs/queue.ts` — understand the queue behaviour: FIFO, one job at a time, `waitForQueueDrain` for graceful shutdown
2. Read `apps/server/src/jobs/steps/discover.ts` — understand label discovery: `docker ps` → find container matching `image_tag` → inspect labels → extract `com.docker.compose.project.config_files` and `com.docker.compose.service`
3. Read `apps/server/src/jobs/steps/validate.ts` — understand what validation checks: compose_path is absolute, file exists, the service is present in the compose file
4. Read `apps/server/src/jobs/executor.ts` — understand the overall orchestration flow and how log files are written
5. Research compose-go v2: use Context7 with `github.com/compose-spec/compose-go/v2`. Query "load project options dotenv". Find how to load a project from a file path with env var resolution, and how to access service image references.

---

## What to Implement

### 1. `internal/jobs/queue.go`

Go channel-based FIFO queue. Sequential — only one job runs at a time.

```go
type Queue struct {
    ch   chan func()
    wg   sync.WaitGroup
    done chan struct{}
}

func NewQueue() *Queue
func (q *Queue) Enqueue(fn func())
func (q *Queue) Drain(timeout time.Duration) bool
// Waits up to timeout for the current job to finish. Returns true if drained cleanly.
```

The queue runs a single goroutine that reads from `ch` and executes functions sequentially. No goroutine per job.

### 2. `internal/jobs/executor.go`

```go
type Executor struct {
    db     *db.DB
    docker *docker.Client // the SDK client
    queue  *Queue
    secret string         // ROLLHOOK_SECRET — for registry auth
    dataDir string
}

func (e *Executor) Submit(job db.Job) error
// Enqueues the job and returns immediately.
// The job runs asynchronously through the queue.

func (e *Executor) run(job db.Job)
// Internal: discover → validate → pull → rollout → notify
// Each step writes to the job's log file.
// On any error: UpdateStatus(failed, err.Error())
// On success: UpdateStatus(success, nil)
```

For now only implement `discover` and `validate` steps — pull and rollout come in Group 7. After validate, mark the job as "running" and log "waiting for Group 7 implementation".

### 3. `internal/jobs/steps/discover.go`

```go
type DiscoveryResult struct {
    ComposePath string
    Service     string
    Project     string
}

func Discover(ctx context.Context, cli *docker.Client, imageTag string) (*DiscoveryResult, error)
```

Algorithm (same as TypeScript):
1. `ListRunningContainers` — get all running containers
2. Find the first container whose `Image` field contains `imageTag` (substring match on the name part, before the tag)
3. `InspectContainer` on the match
4. Extract labels:
   - `com.docker.compose.project.config_files` → take the first path if comma-separated
   - `com.docker.compose.service` → service name
   - `com.docker.compose.project` → project name
5. Return error if no container found or labels missing

### 4. `internal/jobs/steps/validate.go`

```go
func Validate(composePath, service, imageTag string) error
```

Checks:
1. `composePath` is absolute
2. File exists at `composePath`
3. Parse with compose-go: `loader.Load(...)` using the compose file path
4. Verify `service` is present in the parsed project's services
5. Verify the service's `image` field contains the image name from `imageTag` (not the tag — just the name)

Use compose-go's standard env resolution so variables in the compose file are correctly expanded (this handles the IMAGE_TAG pattern naturally).

---

## Validation

```bash
go test ./internal/jobs/...
```

Tests to write:

**Queue:**
- `TestQueue_FIFO` — enqueue 3 jobs, verify they execute in order
- `TestQueue_Sequential` — verify second job only starts after first completes
- `TestQueue_Drain` — drain completes after current job finishes

**Discovery:**
```go
// Use a real Docker client but skip if Docker unavailable
func TestDiscover_FindsRunningContainer(t *testing.T)
// Start a labelled container, run Discover, verify result
```

**Validate:**
- `TestValidate_RelativePath` — returns error for relative path
- `TestValidate_MissingFile` — returns error for non-existent file
- `TestValidate_ServiceNotFound` — returns error if service missing
- `TestValidate_Success` — valid compose file with service + image

Use `os.MkdirTemp` + a real minimal compose file for validate tests (same pattern as TypeScript's `validate.test.ts`).

```bash
go build ./...
go vet ./...
```

---

## Commit

```
feat(server): add job queue, service discovery, and compose validation
```

---

## Done

Append learning notes to `docs/go-rewrite/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 6
```
