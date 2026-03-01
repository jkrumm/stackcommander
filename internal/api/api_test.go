package api_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jkrumm/rollhook/internal/api"
	"github.com/jkrumm/rollhook/internal/db"
	dockerpkg "github.com/jkrumm/rollhook/internal/docker"
	"github.com/jkrumm/rollhook/internal/jobs"
	"github.com/jkrumm/rollhook/internal/middleware"
)

const testSecret = "test-secret-8"

// newTestServer creates a test server with real in-memory store and executor.
// The executor's docker client will fail on actual deploys, but Submit (enqueue)
// works fine — the async worker errors silently without affecting test responses.
func newTestServer(t *testing.T) (http.Handler, *db.Store, string) {
	t.Helper()
	dataDir := t.TempDir()

	sqlDB, err := db.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })

	store := db.NewStore(sqlDB)

	// Docker client from env — may not be available; executor still enqueues fine.
	cli, _ := dockerpkg.NewClient()
	if cli != nil {
		t.Cleanup(func() { cli.Close() })
	}

	exec := jobs.NewExecutor(store, cli, testSecret, dataDir)

	r := chi.NewRouter()
	config := huma.DefaultConfig("RollHook", "test")
	config.DocsPath = ""
	humaAPI := humachi.New(r, config)

	// Auth middleware matching production setup.
	humaAPI.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		if len(ctx.Operation().Security) > 0 {
			token, ok := strings.CutPrefix(ctx.Header("Authorization"), "Bearer ")
			if !ok || token != testSecret {
				_ = huma.WriteErr(humaAPI, ctx, http.StatusUnauthorized, "unauthorized")
				return
			}
		}
		next(ctx)
	})

	api.RegisterDeploy(humaAPI, exec)
	api.RegisterJobsAPI(humaAPI, store)
	r.With(middleware.RequireAuth(testSecret)).Get("/jobs/{id}/logs", api.StreamLogsHandler(store, dataDir))

	return r, store, dataDir
}

func authHeader() string { return "Bearer " + testSecret }

// --- Deploy ---

func TestDeploy_MissingImageTag(t *testing.T) {
	srv, _, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/deploy",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader())
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
		t.Errorf("expected 400/422, got %d", w.Code)
	}
}

func TestDeploy_Valid(t *testing.T) {
	srv, _, _ := newTestServer(t)
	body := `{"image_tag":"localhost:7700/myapp:v1"}`
	req := httptest.NewRequest(http.MethodPost, "/deploy",
		strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader())
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("expected 200/201, got %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		JobID  string `json:"job_id"`
		App    string `json:"app"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.JobID == "" {
		t.Error("expected non-empty job_id")
	}
	if out.App != "myapp" {
		t.Errorf("expected app=myapp, got %q", out.App)
	}
	if out.Status != "queued" {
		t.Errorf("expected status=queued, got %q", out.Status)
	}
}

func TestDeploy_Unauthorized(t *testing.T) {
	srv, _, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/deploy",
		strings.NewReader(`{"image_tag":"x:v1"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

// --- Jobs list ---

func TestListJobs_Empty(t *testing.T) {
	srv, _, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/jobs", nil)
	req.Header.Set("Authorization", authHeader())
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		Jobs []db.Job `json:"jobs"`
	}
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Jobs == nil {
		t.Error("expected non-nil jobs slice")
	}
	if len(out.Jobs) != 0 {
		t.Errorf("expected 0 jobs, got %d", len(out.Jobs))
	}
}

func TestListJobs_WithFilter(t *testing.T) {
	_, store, _ := newTestServer(t)
	// Insert two jobs: one queued, one failed.
	j1 := db.Job{ID: "id-1", App: "alpha", Status: db.StatusQueued, ImageTag: "reg/alpha:v1",
		CreatedAt: time.Now(), UpdatedAt: time.Now()}
	j2 := db.Job{ID: "id-2", App: "beta", Status: db.StatusFailed, ImageTag: "reg/beta:v2",
		CreatedAt: time.Now(), UpdatedAt: time.Now()}
	_ = store.Insert(j1)
	_ = store.Insert(j2)

	// We need a fresh server pointing at the same store — rebuild with same store.
	// Re-use test convenience: build a minimal chi router inline.
	r := chi.NewRouter()
	config := huma.DefaultConfig("RollHook", "test")
	config.DocsPath = ""
	humaAPI := humachi.New(r, config)
	humaAPI.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		if len(ctx.Operation().Security) > 0 {
			token, ok := strings.CutPrefix(ctx.Header("Authorization"), "Bearer ")
			if !ok || token != testSecret {
				_ = huma.WriteErr(humaAPI, ctx, http.StatusUnauthorized, "unauthorized")
				return
			}
		}
		next(ctx)
	})
	api.RegisterJobsAPI(humaAPI, store)

	req := httptest.NewRequest(http.MethodGet, "/jobs?status=queued", nil)
	req.Header.Set("Authorization", authHeader())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		Jobs []db.Job `json:"jobs"`
	}
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out.Jobs) != 1 || out.Jobs[0].ID != "id-1" {
		t.Errorf("expected 1 queued job, got %d: %+v", len(out.Jobs), out.Jobs)
	}
}

// --- Get job ---

func TestGetJob_NotFound(t *testing.T) {
	srv, _, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/jobs/nonexistent", nil)
	req.Header.Set("Authorization", authHeader())
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestGetJob_Found(t *testing.T) {
	srv, store, _ := newTestServer(t)
	j := db.Job{ID: "job-abc", App: "testapp", Status: db.StatusSuccess, ImageTag: "reg/testapp:v3",
		CreatedAt: time.Now(), UpdatedAt: time.Now()}
	_ = store.Insert(j)

	req := httptest.NewRequest(http.MethodGet, "/jobs/job-abc", nil)
	req.Header.Set("Authorization", authHeader())
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got db.Job
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ID != "job-abc" {
		t.Errorf("expected id=job-abc, got %q", got.ID)
	}
	if got.Status != db.StatusSuccess {
		t.Errorf("expected status=success, got %q", got.Status)
	}
}

// --- SSE log stream ---

func TestStreamLogs_NotFound(t *testing.T) {
	srv, _, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/jobs/no-such-job/logs", nil)
	req.Header.Set("Authorization", authHeader())
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestStreamLogs_TerminalJob(t *testing.T) {
	_, store, dataDir := newTestServer(t)

	// Insert a terminal job.
	j := db.Job{ID: "log-job", App: "logapp", Status: db.StatusSuccess, ImageTag: "reg/logapp:v1",
		CreatedAt: time.Now(), UpdatedAt: time.Now()}
	_ = store.Insert(j)

	// Write a log file.
	if err := db.EnsureLogDir(dataDir); err != nil {
		t.Fatalf("ensure log dir: %v", err)
	}
	logPath := db.LogPath(dataDir, "log-job")
	_ = db.AppendLog(logPath, "line one")
	_ = db.AppendLog(logPath, "line two")

	// Build a minimal chi server for the SSE handler.
	r := chi.NewRouter()
	r.With(middleware.RequireAuth(testSecret)).Get("/jobs/{id}/logs", api.StreamLogsHandler(store, dataDir))

	req := httptest.NewRequest(http.MethodGet, "/jobs/log-job/logs", nil)
	req.Header.Set("Authorization", authHeader())

	// Use a context with timeout so the SSE handler exits once [DONE] is sent.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	body := w.Body.String()

	// Verify SSE format and [DONE] terminator.
	if !strings.Contains(body, "data: ") {
		t.Errorf("expected SSE data lines, got: %q", body)
	}
	if !strings.Contains(body, "data: [DONE]") {
		t.Errorf("expected [DONE] terminator in SSE stream, got: %q", body)
	}

	// Parse events and check that both log lines are present.
	scanner := bufio.NewScanner(strings.NewReader(body))
	var events []string
	for scanner.Scan() {
		line := scanner.Text()
		if after, ok := strings.CutPrefix(line, "data: "); ok {
			events = append(events, after)
		}
	}

	found := map[string]bool{}
	for _, e := range events {
		// Log lines are prefixed with a timestamp by AppendLog, so check suffix.
		if strings.Contains(e, "line one") {
			found["line one"] = true
		}
		if strings.Contains(e, "line two") {
			found["line two"] = true
		}
		if e == "[DONE]" {
			found["[DONE]"] = true
		}
	}
	for _, want := range []string{"line one", "line two", "[DONE]"} {
		if !found[want] {
			t.Errorf("expected event %q in stream, got events: %v", want, events)
		}
	}
}

func TestStreamLogs_Unauthorized(t *testing.T) {
	srv, _, _ := newTestServer(t)
	// Insert a job so the handler doesn't 404.
	req := httptest.NewRequest(http.MethodGet, "/jobs/any-id/logs", nil)
	// No Authorization header.
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

// --- App name extraction sanity check (via deploy endpoint) ---

func TestDeploy_AppNameExtraction(t *testing.T) {
	srv, _, _ := newTestServer(t)
	cases := []struct {
		imageTag string
		wantApp  string
	}{
		{"localhost:7700/myapp:v2", "myapp"},
		{"ghcr.io/user/myapp:sha-abc123", "myapp"},
		{"myapp:latest", "myapp"},
	}
	for _, tc := range cases {
		t.Run(tc.imageTag, func(t *testing.T) {
			body := fmt.Sprintf(`{"image_tag":%q}`, tc.imageTag)
			req := httptest.NewRequest(http.MethodPost, "/deploy",
				strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", authHeader())
			w := httptest.NewRecorder()
			srv.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}
			var out struct {
				App string `json:"app"`
			}
			if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if out.App != tc.wantApp {
				t.Errorf("image %q: expected app=%q, got %q", tc.imageTag, tc.wantApp, out.App)
			}
		})
	}
}

// Ensure io is used — suppress unused import if needed.
var _ = io.EOF
