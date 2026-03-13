package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/docker/docker/client"
	"github.com/jkrumm/rollhook/internal/db"
	jobspkg "github.com/jkrumm/rollhook/internal/jobs"
	"github.com/jkrumm/rollhook/internal/jobs/steps"
	oidcpkg "github.com/jkrumm/rollhook/internal/oidc"
)

type DeployInput struct {
	Async bool `query:"async" doc:"Return immediately with status=queued instead of blocking until completion"`
	Body  struct {
		ImageTag string `json:"image_tag" required:"true" doc:"Full Docker image reference to deploy (e.g. registry.example.com/app:sha256)"`
	}
}

type DeployOutput struct {
	Status int
	Body   struct {
		JobID  string  `json:"job_id" doc:"Unique job identifier (UUID)"`
		App    string  `json:"app" doc:"App name derived from image_tag (last path segment before the colon)"`
		Status string  `json:"status" doc:"Job status: queued, running, success, or failed"`
		Error  *string `json:"error,omitempty" doc:"Error message present only when status is failed"`
	}
}

// syncTimeout returns the timeout for synchronous deploy polling.
// Derived from ROLLHOOK_HEALTH_TIMEOUT_MS + 5 minutes for pull/queue buffer.
// Override with ROLLHOOK_SYNC_TIMEOUT_MIN (integer minutes).
func syncTimeout() time.Duration {
	if v := os.Getenv("ROLLHOOK_SYNC_TIMEOUT_MIN"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Minute
		}
	}
	const defaultHealthTimeoutMS = 60_000
	healthMS := defaultHealthTimeoutMS
	if v := os.Getenv("ROLLHOOK_HEALTH_TIMEOUT_MS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			healthMS = n
		}
	}
	return time.Duration(healthMS)*time.Millisecond + 5*time.Minute
}

// checkOIDCLabels validates OIDC claims against service labels.
// Returns an error if the repository or ref is not allowed.
// PR refs (refs/pull/*) are hard-denied before this function is called.
func checkOIDCLabels(claims oidcpkg.Claims, labels map[string]string) error {
	allowedRepos := labels["rollhook.allowed_repos"]
	if allowedRepos == "" {
		return fmt.Errorf("service has no rollhook.allowed_repos label — OIDC deploys are denied by default")
	}
	repoAllowed := false
	for _, r := range strings.Split(allowedRepos, ",") {
		if strings.TrimSpace(r) == claims.Repository {
			repoAllowed = true
			break
		}
	}
	if !repoAllowed {
		return fmt.Errorf("repository %q is not in rollhook.allowed_repos", claims.Repository)
	}

	allowedRefs := labels["rollhook.allowed_refs"]
	if allowedRefs == "" {
		// Default fail-secure: only main and master
		if claims.Ref != "refs/heads/main" && claims.Ref != "refs/heads/master" {
			return fmt.Errorf("ref %q not allowed (default: refs/heads/main, refs/heads/master)", claims.Ref)
		}
		return nil
	}
	for _, ref := range strings.Split(allowedRefs, ",") {
		if strings.TrimSpace(ref) == claims.Ref {
			return nil
		}
	}
	return fmt.Errorf("ref %q is not in rollhook.allowed_refs", claims.Ref)
}

func RegisterDeploy(humaAPI huma.API, exec *jobspkg.Executor, store *db.Store, cli *client.Client) {
	huma.Register(humaAPI, huma.Operation{
		OperationID: "post-deploy",
		Method:      http.MethodPost,
		Path:        "/deploy",
		Summary:     "Trigger a rolling deployment",
		Description: "Enqueues a zero-downtime rolling deploy for the service matching image_tag. By default blocks until the job reaches a terminal state and returns the result. Pass ?async=true to return immediately with status=queued. The app name is derived from the last path segment of image_tag before the colon (e.g. ghcr.io/org/my-api:sha → my-api). Returns 500 with an error field if the deploy fails.",
		Tags:        []string{"Deploy"},
		Security:    []map[string][]string{{"bearer": {}}},
	}, func(ctx context.Context, input *DeployInput) (*DeployOutput, error) {
		if input.Body.ImageTag == "" {
			return nil, huma.NewError(http.StatusBadRequest, "image_tag is required")
		}

		// OIDC authorization: validate repository and ref against service labels.
		if claims, ok := oidcpkg.ClaimsFromContext(ctx); ok {
			// Hard deny: PR refs cannot deploy regardless of label configuration.
			if strings.HasPrefix(claims.Ref, "refs/pull/") {
				return nil, huma.NewError(http.StatusForbidden, "PR ref deploys are not allowed")
			}
			disc, err := steps.Discover(ctx, cli, input.Body.ImageTag)
			if err != nil {
				fmt.Printf("OIDC service discovery error: %v\n", err)
				return nil, huma.NewError(http.StatusInternalServerError, "service discovery failed")
			}
			if err := checkOIDCLabels(claims, disc.Labels); err != nil {
				return nil, huma.NewError(http.StatusForbidden, err.Error())
			}
		}

		job := jobspkg.NewJob(input.Body.ImageTag)
		if err := exec.Submit(job); err != nil {
			if errors.Is(err, jobspkg.ErrQueueFull) || errors.Is(err, jobspkg.ErrQueueDrained) {
				return nil, huma.NewError(http.StatusServiceUnavailable, "server busy, try again later")
			}
			return nil, huma.NewError(http.StatusInternalServerError, err.Error())
		}

		out := &DeployOutput{}
		out.Status = http.StatusOK
		out.Body.JobID = job.ID
		out.Body.App = job.App

		if input.Async {
			out.Body.Status = string(job.Status) // "queued"
			return out, nil
		}

		// Synchronous mode: poll DB until the job reaches a terminal state.
		// Timeout = ROLLHOOK_HEALTH_TIMEOUT_MS + 5 min for image pull + queue wait.
		// Defaults to 10 minutes — well within Traefik's read timeout and long
		// enough for most deploys. Set ROLLHOOK_SYNC_TIMEOUT_MIN to override.
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		deadline := time.After(syncTimeout())

		for {
			select {
			case <-ctx.Done():
				return nil, huma.NewError(http.StatusServiceUnavailable, "request cancelled")
			case <-deadline:
				return nil, huma.NewError(http.StatusInternalServerError, "deploy timed out")
			case <-ticker.C:
				completed, err := store.Get(job.ID)
				if err != nil || completed == nil {
					continue
				}
				if completed.Status == db.StatusSuccess || completed.Status == db.StatusFailed {
					out.Body.Status = string(completed.Status)
					out.Body.Error = completed.Error
					if completed.Status == db.StatusFailed {
						out.Status = http.StatusInternalServerError
					}
					return out, nil
				}
			}
		}
	})
}
