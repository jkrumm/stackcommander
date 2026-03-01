package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

type listJobsInput struct {
	App    string `query:"app"`
	Status string `query:"status"`
	Limit  int    `query:"limit"`
}

type listJobsOutput struct {
	Body struct {
		Jobs []struct{} `json:"jobs"`
	}
}

type getJobInput struct {
	ID string `path:"id"`
}

type getJobOutput struct {
	Body struct {
		ID string `json:"id"`
	}
}

type getJobLogsInput struct {
	ID string `path:"id"`
}

type getJobLogsOutput struct {
	Body struct {
		Logs string `json:"logs"`
	}
}

func RegisterJobs(humaAPI huma.API) {
	huma.Register(humaAPI, huma.Operation{
		OperationID: "get-jobs",
		Method:      http.MethodGet,
		Path:        "/jobs",
		Summary:     "List jobs",
		Tags:        []string{"Jobs"},
		Security:    []map[string][]string{{"bearer": {}}},
	}, func(_ context.Context, _ *listJobsInput) (*listJobsOutput, error) {
		return nil, huma.NewError(http.StatusNotImplemented, "not yet implemented")
	})

	huma.Register(humaAPI, huma.Operation{
		OperationID: "get-job",
		Method:      http.MethodGet,
		Path:        "/jobs/{id}",
		Summary:     "Get job by ID",
		Tags:        []string{"Jobs"},
		Security:    []map[string][]string{{"bearer": {}}},
	}, func(_ context.Context, _ *getJobInput) (*getJobOutput, error) {
		return nil, huma.NewError(http.StatusNotImplemented, "not yet implemented")
	})

	huma.Register(humaAPI, huma.Operation{
		OperationID: "get-job-logs",
		Method:      http.MethodGet,
		Path:        "/jobs/{id}/logs",
		Summary:     "Stream job logs (SSE)",
		Tags:        []string{"Jobs"},
		Security:    []map[string][]string{{"bearer": {}}},
	}, func(_ context.Context, _ *getJobLogsInput) (*getJobLogsOutput, error) {
		return nil, huma.NewError(http.StatusNotImplemented, "not yet implemented")
	})
}
