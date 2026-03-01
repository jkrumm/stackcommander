package api

import (
	"context"
	"net/http"
	"os"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jkrumm/rollhook/internal/state"
)

type healthOutput struct {
	Status int
	Body   struct {
		Status  string `json:"status"`
		Version string `json:"version"`
	}
}

func RegisterHealth(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-health",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Health check",
		Tags:        []string{"Health"},
	}, func(_ context.Context, _ *struct{}) (*healthOutput, error) {
		version := os.Getenv("VERSION")
		if version == "" {
			version = "dev"
		}
		out := &healthOutput{}
		out.Body.Version = version
		if state.IsShuttingDown() {
			out.Status = http.StatusServiceUnavailable
			out.Body.Status = "shutting_down"
		} else {
			out.Status = http.StatusOK
			out.Body.Status = "ok"
		}
		return out, nil
	})
}
