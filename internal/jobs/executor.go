package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/docker/docker/client"
	"github.com/google/uuid"

	"github.com/jkrumm/rollhook/internal/db"
	"github.com/jkrumm/rollhook/internal/jobs/steps"
)

// Executor orchestrates sequential job execution via the internal queue.
type Executor struct {
	store   *db.Store
	docker  *client.Client
	queue   *Queue
	secret  string
	dataDir string
}

// NewExecutor creates an Executor with a started internal queue.
func NewExecutor(store *db.Store, cli *client.Client, secret, dataDir string) *Executor {
	return &Executor{
		store:   store,
		docker:  cli,
		queue:   NewQueue(),
		secret:  secret,
		dataDir: dataDir,
	}
}

// Queue returns the underlying queue for graceful drain on shutdown.
func (e *Executor) Queue() *Queue {
	return e.queue
}

// NewJob builds a db.Job for the given imageTag with queued status.
// Use together with Submit to schedule a deployment.
func NewJob(imageTag string) db.Job {
	now := time.Now().UTC()
	return db.Job{
		ID:        uuid.New().String(),
		App:       extractApp(imageTag),
		Status:    db.StatusQueued,
		ImageTag:  imageTag,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

// Submit persists job in the database, writes the initial log entry, and
// enqueues asynchronous execution. Returns immediately.
func (e *Executor) Submit(job db.Job) error {
	if err := db.EnsureLogDir(e.dataDir); err != nil {
		return fmt.Errorf("executor: ensure log dir: %w", err)
	}
	if err := e.store.Insert(job); err != nil {
		return fmt.Errorf("executor: insert job: %w", err)
	}

	logPath := db.LogPath(e.dataDir, job.ID)
	_ = db.AppendLog(logPath, fmt.Sprintf("[queue] Deployment queued: %s @ %s", job.App, job.ImageTag))

	e.queue.Enqueue(func() { e.run(job) })
	return nil
}

// extractApp derives the app name from an image tag.
// "registry.example.com/myapp:v1" → "myapp"
func extractApp(imageTag string) string {
	last := imageTag
	if idx := strings.LastIndex(imageTag, "/"); idx >= 0 {
		last = imageTag[idx+1:]
	}
	if idx := strings.Index(last, ":"); idx >= 0 {
		last = last[:idx]
	}
	return last
}

func (e *Executor) run(job db.Job) {
	logPath := db.LogPath(e.dataDir, job.ID)
	log := func(line string) {
		if err := db.AppendLog(logPath, line); err != nil {
			slog.Warn("append log failed", "job", job.ID, "err", err)
		}
	}

	log(fmt.Sprintf("[executor] Starting deployment: %s @ %s", job.App, job.ImageTag))
	if err := e.store.UpdateStatus(job.ID, db.StatusRunning, nil); err != nil {
		slog.Error("set job running failed", "job", job.ID, "err", err)
	}

	finalStatus := db.StatusSuccess
	var finalErr *string
	if err := e.execute(context.Background(), job, log); err != nil {
		finalStatus = db.StatusFailed
		msg := err.Error()
		finalErr = &msg
		log(fmt.Sprintf("[executor] ERROR: %s", msg))
	} else {
		log(fmt.Sprintf("[executor] Deployment successful: %s", job.App))
	}

	if err := e.store.UpdateStatus(job.ID, finalStatus, finalErr); err != nil {
		slog.Error("update job status failed", "job", job.ID, "err", err)
	}
}

func (e *Executor) execute(ctx context.Context, job db.Job, log func(string)) error {
	// Step 1: Discover
	log(fmt.Sprintf("[discover] Searching for containers using image: %s", steps.ExtractImageName(job.ImageTag)))
	result, err := steps.Discover(ctx, e.docker, job.ImageTag)
	if err != nil {
		return err
	}
	if err := e.store.UpdateDiscovery(job.ID, result.ComposePath, result.Service); err != nil {
		slog.Warn("persist discovery failed", "job", job.ID, "err", err)
	}
	log(fmt.Sprintf("[discover] Compose file: %s", result.ComposePath))
	log(fmt.Sprintf("[discover] Service: %s", result.Service))
	log("[discover] Discovery complete")

	// Step 2: Validate
	log("[validate] Validating deployment parameters")
	if err := steps.Validate(result.ComposePath, result.Service, job.ImageTag); err != nil {
		return err
	}
	log(fmt.Sprintf("[validate] OK — %s", result.ComposePath))

	// Pull + rollout implemented in Group 7
	log("[executor] waiting for Group 7 implementation (pull + rollout)")
	return nil
}
