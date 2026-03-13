// gendocs generates the OpenAPI spec from the registered huma operations and
// writes it to stdout. Run once to produce apps/dashboard/openapi.json:
//
//	go run ./cmd/gendocs > apps/dashboard/openapi.json
//
// Re-run whenever API operations change to keep the spec in sync.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jkrumm/rollhook/internal/api"
)

func main() {
	r := chi.NewRouter()

	config := huma.DefaultConfig("RollHook API", "0.1.0")
	config.Info.Description = "Webhook-driven rolling deployment orchestrator for Docker Compose stacks"
	config.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"bearer": {
			Type:   "http",
			Scheme: "bearer",
		},
	}
	config.DocsPath = ""

	humaAPI := humachi.New(r, config)

	// Register all operations — nil deps are safe here since no requests are made.
	api.RegisterHealth(humaAPI)
	api.RegisterDeploy(humaAPI, nil, nil, nil)
	api.RegisterJobsAPI(humaAPI, nil)

	// Fetch the spec via the huma-registered /openapi.json route.
	req := httptest.NewRequest(http.MethodGet, "/openapi.json", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		log.Fatalf("unexpected status %d from /openapi.json", rr.Code)
	}

	// Decode the spec so we can inject the SSE endpoint that bypasses huma routing.
	var spec map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &spec); err != nil {
		log.Fatalf("unmarshal spec: %v", err)
	}

	// GET /jobs/{id}/logs is a raw chi SSE handler — huma can't describe it natively.
	// Inject it manually so the spec (and Scalar UI) document the endpoint.
	paths, _ := spec["paths"].(map[string]any)
	paths["/jobs/{id}/logs"] = map[string]any{
		"get": map[string]any{
			"operationId": "stream-job-logs",
			"summary":     "Stream job logs",
			"description": "Streams deployment log lines as Server-Sent Events (`text/event-stream`). Each `data:` event carries a single log line. The stream ends with a `data: [DONE]` sentinel when the job reaches a terminal state.",
			"tags":        []string{"Jobs"},
			"security":    []any{map[string]any{"bearer": []any{}}},
			"parameters": []any{
				map[string]any{
					"name":        "id",
					"in":          "path",
					"required":    true,
					"description": "Job UUID",
					"schema":      map[string]any{"type": "string"},
				},
			},
			"responses": map[string]any{
				"200": map[string]any{
					"description": "SSE log stream",
					"content": map[string]any{
						"text/event-stream": map[string]any{
							"schema": map[string]any{"type": "string"},
						},
					},
				},
			},
		},
	}

	out, err := json.MarshalIndent(spec, "", "  ")
	if err != nil {
		log.Fatalf("marshal spec: %v", err)
	}
	out = append(out, '\n')

	if _, err := os.Stdout.Write(out); err != nil {
		log.Fatal(err)
	}
}
