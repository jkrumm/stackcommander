package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory sqlite: %v", err)
	}
	if err := migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return NewStore(database)
}

func makeJob(id, app, imageTag string) Job {
	now := time.Now().UTC().Truncate(time.Second)
	return Job{
		ID:        id,
		App:       app,
		Status:    StatusQueued,
		ImageTag:  imageTag,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

// strPtr is a test helper to get a *string from a literal.
func strPtr(s string) *string { return &s }

func TestInsertAndGet(t *testing.T) {
	s := newTestStore(t)

	job := makeJob("job-1", "myapp", "registry.io/myapp:sha256")
	if err := s.Insert(job); err != nil {
		t.Fatalf("Insert: %v", err)
	}

	got, err := s.Get("job-1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil {
		t.Fatal("Get returned nil for existing job")
	}
	if got.ID != job.ID {
		t.Errorf("ID: got %q, want %q", got.ID, job.ID)
	}
	if got.App != job.App {
		t.Errorf("App: got %q, want %q", got.App, job.App)
	}
	if got.Status != StatusQueued {
		t.Errorf("Status: got %q, want %q", got.Status, StatusQueued)
	}
	if got.ImageTag != job.ImageTag {
		t.Errorf("ImageTag: got %q, want %q", got.ImageTag, job.ImageTag)
	}
	if got.ComposePath != nil {
		t.Errorf("ComposePath: expected nil, got %v", got.ComposePath)
	}
	if got.Service != nil {
		t.Errorf("Service: expected nil, got %v", got.Service)
	}
	if got.Error != nil {
		t.Errorf("Error: expected nil, got %v", got.Error)
	}
}

func TestGetMissingReturnsNil(t *testing.T) {
	s := newTestStore(t)

	got, err := s.Get("nonexistent")
	if err != nil {
		t.Fatalf("Get: unexpected error %v", err)
	}
	if got != nil {
		t.Errorf("expected nil for missing ID, got %+v", got)
	}
}

func TestUpdateStatusTransitions(t *testing.T) {
	tests := []struct {
		name       string
		transitions []struct {
			status JobStatus
			errMsg *string
		}
		wantStatus JobStatus
		wantError  *string
	}{
		{
			name: "queued to success",
			transitions: []struct {
				status JobStatus
				errMsg *string
			}{
				{StatusRunning, nil},
				{StatusSuccess, nil},
			},
			wantStatus: StatusSuccess,
			wantError:  nil,
		},
		{
			name: "queued to failed with message",
			transitions: []struct {
				status JobStatus
				errMsg *string
			}{
				{StatusRunning, nil},
				{StatusFailed, strPtr("image not found")},
			},
			wantStatus: StatusFailed,
			wantError:  strPtr("image not found"),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := newTestStore(t)
			job := makeJob("job-1", "app", "img:tag")
			if err := s.Insert(job); err != nil {
				t.Fatalf("Insert: %v", err)
			}
			for _, tr := range tc.transitions {
				if err := s.UpdateStatus("job-1", tr.status, tr.errMsg); err != nil {
					t.Fatalf("UpdateStatus(%s): %v", tr.status, err)
				}
			}

			got, err := s.Get("job-1")
			if err != nil || got == nil {
				t.Fatalf("Get: %v, %v", got, err)
			}
			if got.Status != tc.wantStatus {
				t.Errorf("Status: got %q, want %q", got.Status, tc.wantStatus)
			}
			if tc.wantError == nil && got.Error != nil {
				t.Errorf("Error: expected nil, got %q", *got.Error)
			}
			if tc.wantError != nil {
				if got.Error == nil {
					t.Errorf("Error: expected %q, got nil", *tc.wantError)
				} else if *got.Error != *tc.wantError {
					t.Errorf("Error: got %q, want %q", *got.Error, *tc.wantError)
				}
			}
		})
	}
}

func TestUpdateDiscovery(t *testing.T) {
	s := newTestStore(t)
	job := makeJob("job-1", "app", "img:tag")
	if err := s.Insert(job); err != nil {
		t.Fatalf("Insert: %v", err)
	}

	if err := s.UpdateDiscovery("job-1", "/srv/myapp/compose.yml", "myapp"); err != nil {
		t.Fatalf("UpdateDiscovery: %v", err)
	}

	got, err := s.Get("job-1")
	if err != nil || got == nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ComposePath == nil || *got.ComposePath != "/srv/myapp/compose.yml" {
		t.Errorf("ComposePath: got %v", got.ComposePath)
	}
	if got.Service == nil || *got.Service != "myapp" {
		t.Errorf("Service: got %v", got.Service)
	}
}

func TestListFilters(t *testing.T) {
	s := newTestStore(t)

	jobs := []Job{
		makeJob("j1", "app-a", "img:v1"),
		makeJob("j2", "app-a", "img:v2"),
		makeJob("j3", "app-b", "img:v1"),
	}
	for _, j := range jobs {
		if err := s.Insert(j); err != nil {
			t.Fatalf("Insert: %v", err)
		}
	}
	_ = s.UpdateStatus("j1", StatusSuccess, nil)
	_ = s.UpdateStatus("j2", StatusFailed, strPtr("err"))

	t.Run("all jobs", func(t *testing.T) {
		list, err := s.List("", "", 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(list) != 3 {
			t.Errorf("expected 3 jobs, got %d", len(list))
		}
	})

	t.Run("filter by app", func(t *testing.T) {
		list, err := s.List("app-a", "", 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(list) != 2 {
			t.Errorf("expected 2 jobs for app-a, got %d", len(list))
		}
		for _, j := range list {
			if j.App != "app-a" {
				t.Errorf("unexpected app: %q", j.App)
			}
		}
	})

	t.Run("filter by status", func(t *testing.T) {
		list, err := s.List("", "success", 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(list) != 1 {
			t.Errorf("expected 1 success job, got %d", len(list))
		}
		if list[0].ID != "j1" {
			t.Errorf("expected j1, got %q", list[0].ID)
		}
	})

	t.Run("filter by app and status", func(t *testing.T) {
		list, err := s.List("app-a", "failed", 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(list) != 1 {
			t.Errorf("expected 1 job, got %d", len(list))
		}
	})

	t.Run("limit", func(t *testing.T) {
		list, err := s.List("", "", 2)
		if err != nil {
			t.Fatal(err)
		}
		if len(list) != 2 {
			t.Errorf("expected 2 jobs with limit=2, got %d", len(list))
		}
	})
}

func TestListOrderedNewestFirst(t *testing.T) {
	s := newTestStore(t)

	base := time.Now().UTC().Truncate(time.Second)
	for i, id := range []string{"j1", "j2", "j3"} {
		j := Job{
			ID:        id,
			App:       "app",
			Status:    StatusQueued,
			ImageTag:  "img:v1",
			CreatedAt: base.Add(time.Duration(i) * time.Second),
			UpdatedAt: base.Add(time.Duration(i) * time.Second),
		}
		if err := s.Insert(j); err != nil {
			t.Fatalf("Insert %s: %v", id, err)
		}
	}

	list, err := s.List("", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 {
		t.Fatalf("expected 3, got %d", len(list))
	}
	if list[0].ID != "j3" || list[2].ID != "j1" {
		t.Errorf("order: got %q %q %q, want j3 j2 j1", list[0].ID, list[1].ID, list[2].ID)
	}
}

func TestLogHelpers(t *testing.T) {
	dir := t.TempDir()

	t.Run("EnsureLogDir creates directory", func(t *testing.T) {
		if err := EnsureLogDir(dir); err != nil {
			t.Fatalf("EnsureLogDir: %v", err)
		}
		if _, err := os.Stat(filepath.Join(dir, "logs")); err != nil {
			t.Errorf("logs dir not created: %v", err)
		}
	})

	t.Run("LogPath returns correct path", func(t *testing.T) {
		got := LogPath(dir, "abc-123")
		want := filepath.Join(dir, "logs", "abc-123.log")
		if got != want {
			t.Errorf("LogPath: got %q, want %q", got, want)
		}
	})

	t.Run("AppendLog writes lines", func(t *testing.T) {
		if err := EnsureLogDir(dir); err != nil {
			t.Fatal(err)
		}
		logPath := LogPath(dir, "job-42")

		if err := AppendLog(logPath, "first line"); err != nil {
			t.Fatalf("AppendLog: %v", err)
		}
		if err := AppendLog(logPath, "second line"); err != nil {
			t.Fatalf("AppendLog: %v", err)
		}

		data, err := os.ReadFile(logPath)
		if err != nil {
			t.Fatalf("ReadFile: %v", err)
		}
		content := string(data)
		if len(content) == 0 {
			t.Error("log file is empty")
		}
		// Each line should contain a timestamp prefix and the message.
		for _, want := range []string{"first line", "second line"} {
			if !strings.Contains(content, want) {
				t.Errorf("log file missing %q, content: %q", want, content)
			}
		}
	})
}
