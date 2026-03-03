package docker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

// --- Unit tests for unexported helpers (no Docker required) ---

func TestIsLocalhost(t *testing.T) {
	cases := []struct {
		imageTag string
		want     bool
	}{
		{"localhost:7700/app:v1", true},
		{"localhost:5000/rollhook-e2e-hello:v1", true},
		{"127.0.0.1:5000/app:latest", true},
		{"registry.jkrumm.com/app:v1", false},
		{"ghcr.io/user/app:sha256-abc", false},
		{"docker.io/library/nginx:latest", false},
		{"nginx:latest", false},
		{"nginx", false},
	}
	for _, tc := range cases {
		got := isLocalhost(tc.imageTag)
		if got != tc.want {
			t.Errorf("isLocalhost(%q) = %v, want %v", tc.imageTag, got, tc.want)
		}
	}
}

func TestExtractHost(t *testing.T) {
	cases := []struct {
		imageTag string
		want     string
	}{
		{"localhost:7700/app:v1", "localhost:7700"},
		{"127.0.0.1:5000/app:latest", "127.0.0.1:5000"},
		{"registry.jkrumm.com/app:v1", "registry.jkrumm.com"},
		{"ghcr.io/user/repo:latest", "ghcr.io"},
		{"nginx:latest", ""},
		{"nginx", ""},
	}
	for _, tc := range cases {
		got := extractHost(tc.imageTag)
		if got != tc.want {
			t.Errorf("extractHost(%q) = %q, want %q", tc.imageTag, got, tc.want)
		}
	}
}

func TestBuildRegistryAuth(t *testing.T) {
	encoded, err := buildRegistryAuth("rollhook", "secret123", "localhost:7700")
	if err != nil {
		t.Fatalf("buildRegistryAuth error: %v", err)
	}
	if encoded == "" {
		t.Fatal("expected non-empty encoded auth")
	}

	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("base64 decode error: %v", err)
	}

	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if m["username"] != "rollhook" {
		t.Errorf("username = %q, want %q", m["username"], "rollhook")
	}
	if m["password"] != "secret123" {
		t.Errorf("password = %q, want %q", m["password"], "secret123")
	}
	if m["serveraddress"] != "localhost:7700" {
		t.Errorf("serveraddress = %q, want %q", m["serveraddress"], "localhost:7700")
	}
}

func TestParsePullStream(t *testing.T) {
	t.Run("forwards high-signal events only", func(t *testing.T) {
		ndjson := strings.Join([]string{
			`{"status":"Pulling from library/hello-world","id":"latest"}`,
			`{"status":"Pulling fs layer","progressDetail":{},"id":"abc123"}`,
			`{"status":"Downloading","progressDetail":{"current":1024,"total":8192},"id":"abc123"}`,
			`{"status":"Pull complete","progressDetail":{},"id":"abc123"}`,
			`{"status":"Digest: sha256:abc123def456"}`,
			`{"status":"Status: Downloaded newer image for hello-world:latest"}`,
		}, "\n")

		var logged []string
		err := parsePullStream(strings.NewReader(ndjson), func(line string) {
			logged = append(logged, line)
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		want := []string{
			"Status: Downloaded newer image for hello-world:latest",
		}
		if len(logged) != len(want) {
			t.Errorf("got %d log lines, want %d: %v", len(logged), len(want), logged)
			return
		}
		for i, w := range want {
			if logged[i] != w {
				t.Errorf("log[%d] = %q, want %q", i, logged[i], w)
			}
		}
	})

	t.Run("already exists events are suppressed", func(t *testing.T) {
		ndjson := `{"status":"Already exists","progressDetail":{},"id":"abc123"}`
		var logged []string
		_ = parsePullStream(strings.NewReader(ndjson), func(line string) {
			logged = append(logged, line)
		})
		if len(logged) != 0 {
			t.Errorf("expected no log lines, got %v", logged)
		}
	})

	t.Run("returns error on pull error event", func(t *testing.T) {
		ndjson := `{"error":"no basic auth credentials","errorDetail":{"message":"no basic auth credentials"}}`
		err := parsePullStream(strings.NewReader(ndjson), func(string) {})
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !strings.Contains(err.Error(), "no basic auth credentials") {
			t.Errorf("error message mismatch: %v", err)
		}
	})

	t.Run("skips malformed NDJSON lines", func(t *testing.T) {
		ndjson := strings.Join([]string{
			`not valid json`,
			`{"status":"Pull complete"}`,
			`{"status":"Status: Image is up to date for hello-world:latest"}`,
			`{broken`,
		}, "\n")
		var logged []string
		err := parsePullStream(strings.NewReader(ndjson), func(line string) {
			logged = append(logged, line)
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(logged) != 1 || logged[0] != "Status: Image is up to date for hello-world:latest" {
			t.Errorf("expected ['Status: ...'], got %v", logged)
		}
	})

	t.Run("skips blank lines", func(t *testing.T) {
		var count int
		err := parsePullStream(strings.NewReader("\n\n\n"), func(string) { count++ })
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if count != 0 {
			t.Errorf("expected 0 log lines, got %d", count)
		}
	})
}

// --- Integration tests (require a running Docker daemon) ---

func TestListRunningContainers_Integration(t *testing.T) {
	cli, err := NewClient()
	if err != nil {
		t.Skip("Docker not available:", err)
	}
	if _, err := cli.Ping(context.Background()); err != nil {
		cli.Close()
		t.Skip("Docker daemon not reachable:", err)
	}
	defer cli.Close()

	containers, err := ListRunningContainers(context.Background(), cli)
	if err != nil {
		t.Fatalf("ListRunningContainers error: %v", err)
	}
	t.Logf("found %d running containers", len(containers))
}

func TestPullImage_Integration(t *testing.T) {
	cli, err := NewClient()
	if err != nil {
		t.Skip("Docker not available:", err)
	}
	if _, err := cli.Ping(context.Background()); err != nil {
		cli.Close()
		t.Skip("Docker daemon not reachable:", err)
	}
	defer cli.Close()

	var logged []string
	err = PullImage(context.Background(), cli, "hello-world:latest", func(line string) {
		logged = append(logged, line)
		t.Logf("[pull] %s", line)
	}, "")
	if err != nil {
		t.Fatalf("PullImage error: %v", err)
	}
	if len(logged) == 0 {
		t.Error("expected at least one log line from pull stream")
	}
}
