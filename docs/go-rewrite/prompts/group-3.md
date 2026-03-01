# Group 3: SQLite + Job Persistence

## What You're Doing

Set up modernc.org/sqlite (pure Go, no CGO), implement the jobs table schema with idempotent migrations, and write the full Job CRUD layer. Job log files go in `data/logs/<job-id>.log`. This is the persistence foundation everything else builds on.

---

## Research & Exploration First

1. Read `apps/server/src/db/client.ts` — understand the migration approach (PRAGMA table_info idempotent column additions) and schema
2. Read `apps/server/src/db/jobs.ts` — understand all CRUD operations: insert, get, list (with filters), updateStatus, updateDiscovery
3. Read `packages/rollhook/src/types.ts` — understand JobStatus and JobResult types to match in Go
4. Research modernc.org/sqlite with Context7 — specifically: how to open a DB, how to run migrations, whether it supports WAL mode, the driver registration pattern

---

## What to Implement

### 1. Job types in `internal/db/jobs.go`

```go
type JobStatus string

const (
    StatusQueued    JobStatus = "queued"
    StatusRunning   JobStatus = "running"
    StatusSuccess   JobStatus = "success"
    StatusFailed    JobStatus = "failed"
)

type Job struct {
    ID          string     `json:"id"`
    App         string     `json:"app"`
    Status      JobStatus  `json:"status"`
    ImageTag    string     `json:"image_tag"`
    ComposePath *string    `json:"compose_path,omitempty"`
    Service     *string    `json:"service,omitempty"`
    Error       *string    `json:"error,omitempty"`
    CreatedAt   time.Time  `json:"created_at"`
    UpdatedAt   time.Time  `json:"updated_at"`
}
```

### 2. `internal/db/client.go`

- Open SQLite at `data/rollhook.db` (create directory if not exists)
- Enable WAL mode for concurrent reads during SSE log streaming
- Run migrations on startup — use `PRAGMA table_info` approach for idempotent column adds (matching existing TypeScript pattern)
- Expose `*sql.DB` for injection into handlers

Schema (same as current TypeScript):
```sql
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    app TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    image_tag TEXT NOT NULL,
    compose_path TEXT,
    service TEXT,
    error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 3. `internal/db/jobs.go`

Implement:
- `Insert(job Job) error`
- `Get(id string) (*Job, error)` — returns nil if not found
- `List(app, status string, limit int) ([]Job, error)` — all params optional/zero-value means no filter
- `UpdateStatus(id string, status JobStatus, errMsg *string) error`
- `UpdateDiscovery(id string, composePath, service string) error`

### 4. Log file helpers

Helper functions (can live in `internal/db/jobs.go` or a small `internal/jobs/logs.go`):
- `LogPath(dataDir, jobID string) string` — returns `data/logs/<job-id>.log`
- `AppendLog(logPath, line string) error` — appends `[timestamp] line\n`
- `EnsureLogDir(dataDir string) error` — creates `data/logs/` if not exists

---

## Validation

```bash
go test ./internal/db/...
```

Write table-driven tests covering:
- Insert and Get round-trip
- List with app filter, status filter, limit
- UpdateStatus transitions (queued → running → success, queued → running → failed with error message)
- UpdateDiscovery sets compose_path and service
- Get returns nil for missing ID (not an error)
- Log file append and path construction

Use an in-memory SQLite database for tests (`:memory:` path) so tests are fast and isolated.

```bash
go build ./...
go vet ./...
```

---

## Commit

```
feat(server): add SQLite persistence layer and job CRUD
```

---

## Done

Append learning notes to `docs/go-rewrite/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 3
```
