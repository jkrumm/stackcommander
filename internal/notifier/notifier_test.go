package notifier

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jkrumm/rollhook/internal/db"
)

func makeJob(status db.JobStatus, errMsg *string) db.Job {
	return db.Job{
		ID:        "test-job-id",
		App:       "myapp",
		Status:    status,
		ImageTag:  "localhost:7700/myapp:v2",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Error:     errMsg,
	}
}

func TestNotifier_Webhook(t *testing.T) {
	var received []byte
	var contentType string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentType = r.Header.Get("Content-Type")
		received, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	job := makeJob(db.StatusSuccess, nil)
	Notify(context.Background(), Config{WebhookURL: ts.URL}, job)

	if len(received) == 0 {
		t.Fatal("webhook received no body")
	}
	if contentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", contentType)
	}

	var got db.Job
	if err := json.Unmarshal(received, &got); err != nil {
		t.Fatalf("unmarshal webhook body: %v", err)
	}
	if got.ID != job.ID {
		t.Errorf("job ID = %q, want %q", got.ID, job.ID)
	}
	if got.App != job.App {
		t.Errorf("job App = %q, want %q", got.App, job.App)
	}
	if got.Status != db.StatusSuccess {
		t.Errorf("job Status = %q, want success", got.Status)
	}
}

func TestNotifier_Pushover(t *testing.T) {
	var received map[string]string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &received)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	// Override the Pushover endpoint to point at our test server.
	orig := pushoverEndpoint
	pushoverEndpoint = ts.URL
	defer func() { pushoverEndpoint = orig }()

	job := makeJob(db.StatusSuccess, nil)
	Notify(context.Background(), Config{PushoverUserKey: "userkey", PushoverAppToken: "apptoken"}, job)

	if received["token"] != "apptoken" {
		t.Errorf("token = %q, want apptoken", received["token"])
	}
	if received["user"] != "userkey" {
		t.Errorf("user = %q, want userkey", received["user"])
	}
	if received["title"] == "" {
		t.Error("title is empty")
	}
	if received["message"] == "" {
		t.Error("message is empty")
	}
}

func TestNotifier_Pushover_FailureTitle(t *testing.T) {
	var received map[string]string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &received)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	orig := pushoverEndpoint
	pushoverEndpoint = ts.URL
	defer func() { pushoverEndpoint = orig }()

	errMsg := "compose file not found"
	job := makeJob(db.StatusFailed, &errMsg)
	Notify(context.Background(), Config{PushoverUserKey: "u", PushoverAppToken: "t"}, job)

	if received["title"] == "" {
		t.Error("title is empty for failed job")
	}
	// Title should contain the failure indicator, not success.
	if received["title"] == "✅ Deployed myapp" {
		t.Error("failed job should not produce success title")
	}
}

func TestNotifier_NotCalledWhenUnconfigured(t *testing.T) {
	callCount := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	// Empty config — no notifications should be sent.
	Notify(context.Background(), Config{}, makeJob(db.StatusSuccess, nil))

	if callCount != 0 {
		t.Errorf("expected 0 HTTP calls, got %d", callCount)
	}
}

func TestNotifier_WebhookError_DoesNotPanic(t *testing.T) {
	// Webhook that returns 500 should not propagate the error.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	// Should complete without panic or fatal.
	Notify(context.Background(), Config{WebhookURL: ts.URL}, makeJob(db.StatusSuccess, nil))
}
