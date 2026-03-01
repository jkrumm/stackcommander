package api

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/jkrumm/rollhook/internal/db"
)

type listJobsInput struct {
	App    string `query:"app"`
	Status string `query:"status"`
	Limit  int    `query:"limit"`
}

type listJobsOutput struct {
	Body struct {
		Jobs []db.Job `json:"jobs"`
	}
}

type getJobInput struct {
	ID string `path:"id"`
}

type getJobOutput struct {
	Body db.Job
}

// RegisterJobsAPI registers the GET /jobs and GET /jobs/{id} handlers via huma.
// The SSE stream endpoint /jobs/{id}/logs is registered separately via StreamLogsHandler.
func RegisterJobsAPI(humaAPI huma.API, store *db.Store) {
	huma.Register(humaAPI, huma.Operation{
		OperationID: "get-jobs",
		Method:      http.MethodGet,
		Path:        "/jobs",
		Summary:     "List jobs with optional filters",
		Tags:        []string{"Jobs"},
		Security:    []map[string][]string{{"bearer": {}}},
	}, func(_ context.Context, input *listJobsInput) (*listJobsOutput, error) {
		jobs, err := store.List(input.App, input.Status, input.Limit)
		if err != nil {
			return nil, huma.NewError(http.StatusInternalServerError, err.Error())
		}
		if jobs == nil {
			jobs = []db.Job{}
		}
		out := &listJobsOutput{}
		out.Body.Jobs = jobs
		return out, nil
	})

	huma.Register(humaAPI, huma.Operation{
		OperationID: "get-job",
		Method:      http.MethodGet,
		Path:        "/jobs/{id}",
		Summary:     "Get job status",
		Tags:        []string{"Jobs"},
		Security:    []map[string][]string{{"bearer": {}}},
	}, func(_ context.Context, input *getJobInput) (*getJobOutput, error) {
		job, err := store.Get(input.ID)
		if err != nil {
			return nil, huma.NewError(http.StatusInternalServerError, err.Error())
		}
		if job == nil {
			return nil, huma.NewError(http.StatusNotFound, fmt.Sprintf("job %q not found", input.ID))
		}
		out := &getJobOutput{}
		out.Body = *job
		return out, nil
	})
}

func isTerminal(status db.JobStatus) bool {
	return status == db.StatusSuccess || status == db.StatusFailed
}

// StreamLogsHandler returns an http.HandlerFunc that streams job logs as SSE.
// Register this directly on Chi (not through huma) to avoid response wrapping.
func StreamLogsHandler(store *db.Store, dataDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		job, err := store.Get(id)
		if err != nil || job == nil {
			http.NotFound(w, r)
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")

		logPath := db.LogPath(dataDir, id)

		// The executor writes the first log line synchronously in Submit before
		// returning the job_id to the client. Still retry briefly in case of
		// filesystem latency or a queued job that hasn't started yet.
		var f *os.File
		for i := 0; i < 20; i++ {
			f, err = os.Open(logPath)
			if err == nil {
				break
			}
			select {
			case <-r.Context().Done():
				return
			case <-time.After(100 * time.Millisecond):
			}
		}
		if err != nil {
			// Log file never appeared — send [DONE] so clients don't hang.
			fmt.Fprintf(w, "data: [DONE]\n\n")
			flusher.Flush()
			return
		}
		defer f.Close()

		reader := bufio.NewReader(f)
		for {
			line, readErr := reader.ReadString('\n')
			if readErr == nil {
				// Complete line (includes the '\n' delimiter).
				line = strings.TrimRight(line, "\r\n")
				if line != "" {
					fmt.Fprintf(w, "data: %s\n\n", line)
					flusher.Flush()
				}
				continue
			}
			if readErr != io.EOF {
				return // Unexpected read error.
			}

			// At EOF: check if job has reached a terminal state.
			current, _ := store.Get(id)
			if current != nil && isTerminal(current.Status) {
				// Flush any partial line that arrived without a newline.
				if line != "" {
					fmt.Fprintf(w, "data: %s\n\n", strings.TrimRight(line, "\r\n"))
					flusher.Flush()
				}
				fmt.Fprintf(w, "data: [DONE]\n\n")
				flusher.Flush()
				return
			}

			// Job still running — wait for more data.
			select {
			case <-r.Context().Done():
				return
			case <-time.After(100 * time.Millisecond):
			}
		}
	}
}
