package registry

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

const (
	zotPort      = 5000
	readyTimeout = 10 * time.Second
	pollInterval = 200 * time.Millisecond
	stopTimeout  = 5 * time.Second
)

// Manager starts and manages Zot as a child subprocess.
// Zot binds to 127.0.0.1:5000 — never exposed externally.
type Manager struct {
	dataDir string
	secret  string
	mu      sync.Mutex
	cmd     *exec.Cmd
	done    chan struct{} // closed by the watcher goroutine when zot exits
}

// NewManager creates a registry Manager. Call Start to launch Zot.
func NewManager(dataDir, secret string) *Manager {
	return &Manager{dataDir: dataDir, secret: secret}
}

// Start writes Zot config + htpasswd, launches the Zot subprocess,
// pipes its stdout/stderr line-by-line with a "[zot]" prefix, and polls
// http://127.0.0.1:5000/v2/ until ready (200 or 401) or ctx deadline.
func (m *Manager) Start(ctx context.Context) error {
	registryDir := filepath.Join(m.dataDir, "registry")
	if err := os.MkdirAll(registryDir, 0o755); err != nil {
		return fmt.Errorf("create registry dir: %w", err)
	}

	configPath := filepath.Join(registryDir, "config.json")
	htpasswdPath := filepath.Join(registryDir, ".htpasswd")

	configJSON := GenerateZotConfig(registryDir, htpasswdPath, zotPort)
	if err := os.WriteFile(configPath, []byte(configJSON), 0o600); err != nil {
		return fmt.Errorf("write zot config: %w", err)
	}

	htpasswd, err := GenerateHtpasswd(ZotPassword(m.secret))
	if err != nil {
		return fmt.Errorf("generate htpasswd: %w", err)
	}
	if err := os.WriteFile(htpasswdPath, []byte(htpasswd), 0o600); err != nil {
		return fmt.Errorf("write htpasswd: %w", err)
	}

	cmd := exec.Command("zot", "serve", configPath) //nolint:gosec
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("zot stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("zot stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start zot: %w", err)
	}

	done := make(chan struct{})

	m.mu.Lock()
	m.cmd = cmd
	m.done = done
	m.mu.Unlock()

	// Line-buffered log forwarders — avoids mid-line splits from byte-chunk reads.
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			slog.Info(scanner.Text(), "source", "zot")
		}
	}()
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			slog.Info(scanner.Text(), "source", "zot")
		}
	}()

	// Single watcher goroutine owns the cmd.Wait() call.
	go func() {
		defer close(done)
		if err := cmd.Wait(); err != nil {
			slog.Error("zot exited unexpectedly", "error", err, "source", "zot")
		}
		m.mu.Lock()
		m.cmd = nil
		m.mu.Unlock()
	}()

	return m.waitUntilReady(ctx)
}

func (m *Manager) waitUntilReady(ctx context.Context) error {
	deadline := time.Now().Add(readyTimeout)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	addr := fmt.Sprintf("http://127.0.0.1:%d/v2/", zotPort)

	for time.Now().Before(deadline) {
		resp, err := client.Get(addr) //nolint:noctx
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusUnauthorized {
				slog.Info("registry ready", "source", "zot")
				return nil
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollInterval):
		}
	}

	return fmt.Errorf("zot failed to start within %s", readyTimeout)
}

// Stop sends SIGTERM to Zot and waits up to 5 s before force-killing.
func (m *Manager) Stop() error {
	m.mu.Lock()
	cmd := m.cmd
	done := m.done
	m.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return nil
	}

	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		// Process already exited — nothing to do.
		return nil //nolint:nilerr
	}

	select {
	case <-done:
	case <-time.After(stopTimeout):
		_ = cmd.Process.Kill()
		<-done
	}

	return nil
}

// IsRunning reports whether the Zot subprocess is currently running.
func (m *Manager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cmd != nil
}

// Credentials returns the internal Zot username and password.
// These are deterministic — same values every restart.
func (m *Manager) Credentials() (user, password string) {
	return ZotUser, ZotPassword(m.secret)
}
