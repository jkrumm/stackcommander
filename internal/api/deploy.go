package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	jobspkg "github.com/jkrumm/rollhook/internal/jobs"
)

type DeployInput struct {
	Body struct {
		ImageTag string `json:"image_tag" required:"true" doc:"Docker image tag to deploy (e.g. registry.example.com/app:sha)"`
	}
}

type DeployOutput struct {
	Body struct {
		JobID  string `json:"job_id"`
		App    string `json:"app"`
		Status string `json:"status"`
	}
}

func RegisterDeploy(humaAPI huma.API, exec *jobspkg.Executor) {
	huma.Register(humaAPI, huma.Operation{
		OperationID: "post-deploy",
		Method:      http.MethodPost,
		Path:        "/deploy",
		Summary:     "Trigger a rolling deployment",
		Tags:        []string{"Deploy"},
		Security:    []map[string][]string{{"bearer": {}}},
	}, func(_ context.Context, input *DeployInput) (*DeployOutput, error) {
		if input.Body.ImageTag == "" {
			return nil, huma.NewError(http.StatusBadRequest, "image_tag is required")
		}
		job := jobspkg.NewJob(input.Body.ImageTag)
		if err := exec.Submit(job); err != nil {
			return nil, huma.NewError(http.StatusInternalServerError, err.Error())
		}
		out := &DeployOutput{}
		out.Body.JobID = job.ID
		out.Body.App = job.App
		out.Body.Status = string(job.Status)
		return out, nil
	})
}
