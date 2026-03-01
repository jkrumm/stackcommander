package api

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jkrumm/rollhook/internal/db"
	jobspkg "github.com/jkrumm/rollhook/internal/jobs"
)

type DeployInput struct {
	Async bool `query:"async" doc:"If true, returns immediately with queued status without waiting for completion"`
	Body  struct {
		ImageTag string `json:"image_tag" required:"true" doc:"Docker image tag to deploy (e.g. registry.example.com/app:sha)"`
	}
}

type DeployOutput struct {
	Status int
	Body   struct {
		JobID  string  `json:"job_id"`
		App    string  `json:"app"`
		Status string  `json:"status"`
		Error  *string `json:"error,omitempty"`
	}
}

func RegisterDeploy(humaAPI huma.API, exec *jobspkg.Executor, store *db.Store) {
	huma.Register(humaAPI, huma.Operation{
		OperationID: "post-deploy",
		Method:      http.MethodPost,
		Path:        "/deploy",
		Summary:     "Trigger a rolling deployment",
		Tags:        []string{"Deploy"},
		Security:    []map[string][]string{{"bearer": {}}},
	}, func(ctx context.Context, input *DeployInput) (*DeployOutput, error) {
		if input.Body.ImageTag == "" {
			return nil, huma.NewError(http.StatusBadRequest, "image_tag is required")
		}
		job := jobspkg.NewJob(input.Body.ImageTag)
		if err := exec.Submit(job); err != nil {
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
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		deadline := time.After(30 * time.Minute)

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
