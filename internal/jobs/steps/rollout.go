package steps

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"

	dockerpkg "github.com/jkrumm/rollhook/internal/docker"
)

const (
	defaultHealthTimeoutMS = 60_000
	pollIntervalMS         = 1_000
)

// Rollout performs a zero-downtime rolling deploy:
// scale up new containers, wait for health, drain old containers.
// On any failure it rolls back new containers before returning the error.
func Rollout(ctx context.Context, cli *client.Client, composePath, service, project, imageTag string, logFn func(string)) error {
	healthTimeoutMS := envInt("ROLLHOOK_HEALTH_TIMEOUT_MS", defaultHealthTimeoutMS)
	cwd := filepath.Dir(composePath)

	// 1. Capture old container IDs before scale-up.
	oldContainers, err := dockerpkg.ListServiceContainers(ctx, cli, project, service)
	if err != nil {
		return err
	}
	oldIDs := make(map[string]struct{}, len(oldContainers))
	for _, c := range oldContainers {
		oldIDs[c.ID] = struct{}{}
	}

	scaleCount := scaleTarget(len(oldIDs))
	logFn(fmt.Sprintf("[rollout] Rolling out service: %s (IMAGE_TAG=%s)", service, imageTag))
	logFn(fmt.Sprintf("[rollout] Scaling service %s from %d→%d replicas", service, len(oldIDs), scaleCount))

	// Write IMAGE_TAG into a job-scoped temp env file — never touch the user's .env.
	// Docker Compose v2 --env-file replaces the auto-loaded .env entirely, so we read
	// the user's .env (if present), merge IMAGE_TAG in, and write a temp file. This
	// preserves all the user's existing variables while overriding IMAGE_TAG.
	tmpEnv, err := writeTempEnv(cwd, imageTag)
	if err != nil {
		return fmt.Errorf("rollout: prepare env file: %w", err)
	}
	defer func() {
		if removeErr := os.Remove(tmpEnv); removeErr != nil {
			logFn(fmt.Sprintf("[rollout] Warning: failed to remove temp env file: %s", removeErr))
		}
	}()

	// 2. Scale up via docker compose subprocess.
	cmd := exec.CommandContext(ctx, "docker", "compose",
		"-f", composePath,
		"--env-file", tmpEnv,
		"up", "-d", "--no-recreate",
		"--scale", fmt.Sprintf("%s=%d", service, scaleCount),
	)
	cmd.Dir = cwd
	out, err := cmd.CombinedOutput()
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			logFn(fmt.Sprintf("[rollout] %s", line))
		}
	}
	if err != nil {
		return fmt.Errorf("docker compose up --scale failed: %w", err)
	}

	// 3. Find new containers — poll to account for Docker API propagation delay.
	newContainers, err := pollNewContainers(ctx, cli, project, service, oldIDs)
	if err != nil {
		return err
	}
	newIDs := make([]string, len(newContainers))
	for i, c := range newContainers {
		newIDs[i] = c.ID
	}

	logFn(fmt.Sprintf("[rollout] Waiting for %d new container(s) to become healthy", len(newContainers)))

	// 4. Wait for each new container — each gets its own deadline.
	for i, c := range newContainers {
		id := c.ID
		logFn(fmt.Sprintf("[rollout] Waiting for container %s to become healthy (%d/%d)", id[:min(12, len(id))], i+1, len(newContainers)))

		if err := waitHealthy(ctx, cli, id, healthTimeoutMS, logFn); err != nil {
			rollbackContainers(cli, newIDs, err.Error(), logFn)
			return fmt.Errorf("rolling deploy failed: %w", err)
		}
	}

	// 5. All new containers healthy — drain old containers.
	for id := range oldIDs {
		short := id[:min(12, len(id))]
		logFn(fmt.Sprintf("[rollout] Draining old container %s", short))
		if err := dockerpkg.StopContainer(ctx, cli, id); err != nil {
			logFn(fmt.Sprintf("[rollout] Warning stopping %s: %s", short, err))
		}
		if err := dockerpkg.RemoveContainer(ctx, cli, id); err != nil {
			logFn(fmt.Sprintf("[rollout] Warning removing %s: %s", short, err))
		}
	}

	logFn(fmt.Sprintf("[rollout] Service %s rolled out successfully", service))
	return nil
}

// scaleTarget returns the number of replicas to scale up to.
// First deploy (no existing containers) starts 1 replica; subsequent deploys double.
func scaleTarget(currentCount int) int {
	if currentCount == 0 {
		return 1
	}
	return currentCount * 2
}

// waitHealthy polls container health until healthy, unhealthy, or timeout.
func waitHealthy(ctx context.Context, cli *client.Client, id string, timeoutMS int, logFn func(string)) error {
	short := id[:min(12, len(id))]
	deadline := time.Now().Add(time.Duration(timeoutMS) * time.Millisecond)
	start := time.Now()

	for {
		if time.Now().After(deadline) {
			return fmt.Errorf("container %s did not become healthy within %ds", short, timeoutMS/1000)
		}

		detail, err := dockerpkg.InspectContainer(ctx, cli, id)
		if err != nil {
			return fmt.Errorf("container inspection failed: %w", err)
		}

		if detail.State.Health == nil {
			return fmt.Errorf("container %s has no healthcheck — add a HEALTHCHECK to your service for zero-downtime deploys", short)
		}

		switch detail.State.Health.Status {
		case "healthy":
			elapsed := time.Since(start).Seconds()
			logFn(fmt.Sprintf("[rollout] Container %s healthy after %.1fs", short, elapsed))
			return nil
		case "unhealthy":
			return fmt.Errorf("container %s became unhealthy", short)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollIntervalMS * time.Millisecond):
		}
	}
}

// rollbackContainers stops and removes the given container IDs.
// Uses a background context so cleanup completes even if the parent context is cancelled.
func rollbackContainers(cli *client.Client, ids []string, reason string, logFn func(string)) {
	bctx := context.Background()
	logFn(fmt.Sprintf("[rollout] Rollback triggered: %s", reason))
	for _, id := range ids {
		short := id[:min(12, len(id))]
		logFn(fmt.Sprintf("[rollout] Rollback: stopping new container %s", short))
		if err := dockerpkg.StopContainer(bctx, cli, id); err != nil {
			logFn(fmt.Sprintf("[rollout] Rollback cleanup error: %s", err))
		}
		if err := dockerpkg.RemoveContainer(bctx, cli, id); err != nil {
			logFn(fmt.Sprintf("[rollout] Rollback cleanup error: %s", err))
		}
	}
}

// pollNewContainers retries findNewContainers up to 10 times with 500ms delays
// to handle Docker API propagation delay after compose scale-up.
func pollNewContainers(ctx context.Context, cli *client.Client, project, service string, oldIDs map[string]struct{}) ([]container.Summary, error) {
	found, err := findNewContainers(ctx, cli, project, service, oldIDs)
	if err != nil {
		return nil, err
	}
	if len(found) > 0 {
		return found, nil
	}

	for attempt := 0; attempt < 10; attempt++ {
		time.Sleep(500 * time.Millisecond)
		found, err = findNewContainers(ctx, cli, project, service, oldIDs)
		if err != nil {
			return nil, err
		}
		if len(found) > 0 {
			return found, nil
		}
	}

	return nil, fmt.Errorf("scale-up produced no new containers for service %s after 5s", service)
}

func findNewContainers(ctx context.Context, cli *client.Client, project, service string, oldIDs map[string]struct{}) ([]container.Summary, error) {
	all, err := dockerpkg.ListServiceContainers(ctx, cli, project, service)
	if err != nil {
		return nil, err
	}
	var result []container.Summary
	for _, c := range all {
		if _, isOld := oldIDs[c.ID]; !isOld {
			result = append(result, c)
		}
	}
	return result, nil
}

// writeTempEnv reads the user's .env (if present), merges IMAGE_TAG, and writes
// a temp file. Returns the temp file path; caller is responsible for removing it.
func writeTempEnv(cwd, imageTag string) (string, error) {
	content := ""
	dotEnvPath := filepath.Join(cwd, ".env")
	if data, err := os.ReadFile(dotEnvPath); err == nil {
		content = string(data)
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("reading .env: %w", err)
	}

	merged := setEnvLine(content, "IMAGE_TAG", imageTag)

	f, err := os.CreateTemp("", "rollhook-*.env")
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := f.WriteString(merged); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// setEnvLine merges KEY=VALUE into .env file content.
// Replaces the last occurrence of KEY= if present, appends otherwise.
// Preserves the file's trailing-newline convention.
func setEnvLine(content, key, value string) string {
	keyPrefix := key + "="
	newLine := key + "=" + value
	lines := strings.Split(content, "\n")

	lastIdx := -1
	for i, line := range lines {
		if strings.HasPrefix(line, keyPrefix) {
			lastIdx = i
		}
	}
	if lastIdx >= 0 {
		lines[lastIdx] = newLine
		return strings.Join(lines, "\n")
	}

	// Append, preserving the file's trailing-newline convention.
	if content == "" {
		return newLine
	}
	if strings.HasSuffix(content, "\n") {
		return content + newLine + "\n"
	}
	return content + "\n" + newLine
}

// envInt reads an integer env var, returning defaultVal if unset or unparseable.
func envInt(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return defaultVal
}
