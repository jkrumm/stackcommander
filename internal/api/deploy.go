package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
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

func RegisterDeploy(humaAPI huma.API) {
	huma.Register(humaAPI, huma.Operation{
		OperationID: "post-deploy",
		Method:      http.MethodPost,
		Path:        "/deploy",
		Summary:     "Trigger a rolling deployment",
		Tags:        []string{"Deploy"},
		Security:    []map[string][]string{{"bearer": {}}},
	}, func(_ context.Context, _ *DeployInput) (*DeployOutput, error) {
		return nil, huma.NewError(http.StatusNotImplemented, "not yet implemented")
	})
}
