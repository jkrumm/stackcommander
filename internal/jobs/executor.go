package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/docker/docker/client"
	"github.com/google/uuid"

	"github.com/jkrumm/rollhook/internal/db"
	"github.com/jkrumm/rollhook/internal/jobs/steps"
	"github.com/jkrumm/rollhook/internal/notifier"
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
// ctx is forwarded to the queue so SIGTERM can interrupt in-flight deploys.
func NewExecutor(ctx context.Context, store *db.Store, cli *client.Client, secret, dataDir string) *Executor {
	return &Executor{
		store:   store,
		docker:  cli,
		queue:   NewQueue(ctx),
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

	if err := e.queue.Enqueue(func(ctx context.Context) { e.run(ctx, job) }); err != nil {
		return fmt.Errorf("executor: %w", err)
	}
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

func (e *Executor) run(ctx context.Context, job db.Job) {
	logPath := db.LogPath(e.dataDir, job.ID)

	// Open log file once for the full job duration — avoids open/write/close per line.
	// The SSE reader opens independently with O_RDONLY so there is no conflict.
	logFile, err := db.OpenLog(logPath)
	if err != nil {
		slog.Error("failed to open log file", "job", job.ID, "err", err)
	}
	if logFile != nil {
		defer logFile.Close()
	}
	log := func(line string) {
		if logFile == nil {
			return
		}
		if err := db.AppendLogLine(logFile, line); err != nil {
			slog.Warn("append log failed", "job", job.ID, "err", err)
		}
	}

	if err := e.store.UpdateStatus(job.ID, db.StatusRunning, nil); err != nil {
		slog.Error("set job running failed", "job", job.ID, "err", err)
	}

	finalStatus := db.StatusSuccess
	var finalErr *string
	if err := e.execute(ctx, job, log); err != nil {
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

	notifyJob := job
	notifyJob.Status = finalStatus
	notifyJob.Error = finalErr
	notifier.Notify(context.Background(), notifier.Config{
		PushoverUserKey:  os.Getenv("PUSHOVER_USER_KEY"),
		PushoverAppToken: os.Getenv("PUSHOVER_APP_TOKEN"),
		WebhookURL:       os.Getenv("NOTIFICATION_WEBHOOK_URL"),
	}, notifyJob)
}

func (e *Executor) execute(ctx context.Context, job db.Job, log func(string)) error {
	// Step 1: Discover
	result, err := steps.Discover(ctx, e.docker, job.ImageTag)
	if err != nil {
		return err
	}
	if err := e.store.UpdateDiscovery(job.ID, result.ComposePath, result.Service); err != nil {
		slog.Warn("persist discovery failed", "job", job.ID, "err", err)
	}
	log(fmt.Sprintf("[discover] %s in %s", result.Service, result.ComposePath))

	// Step 2: Validate
	if err := steps.Validate(result.ComposePath, result.Service, job.ImageTag, log); err != nil {
		log("[validate] FAILED")
		return err
	}
	log("[validate] OK")

	// Step 3: Pull
	if err := steps.Pull(ctx, e.docker, job.ImageTag, e.secret, log); err != nil {
		return err
	}

	// Step 4: Rollout
	if err := steps.Rollout(ctx, e.docker, result.ComposePath, result.Service, result.Project, job.ImageTag, log); err != nil {
		return err
	}

	return nil
}
