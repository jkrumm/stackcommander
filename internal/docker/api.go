package docker

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/errdefs"
)

// pullLogPrefixes are the high-signal pull events forwarded to logFn.
// A typical image with 20 layers emits 100+ lines; this filter keeps it to ~10.
var pullLogPrefixes = []string{
	"Status:",
}

// ListRunningContainers returns all running containers on the Docker host.
func ListRunningContainers(ctx context.Context, cli *client.Client) ([]container.Summary, error) {
	containers, err := cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing running containers: %w", err)
	}
	return containers, nil
}

// ListServiceContainers returns all containers (any state) matching the given
// Compose project and service labels. Includes created/starting containers so
// rollout health polling can track newly scaled replicas.
func ListServiceContainers(ctx context.Context, cli *client.Client, project, service string) ([]container.Summary, error) {
	f := filters.NewArgs()
	f.Add("label", "com.docker.compose.project="+project)
	f.Add("label", "com.docker.compose.service="+service)
	containers, err := cli.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: f,
	})
	if err != nil {
		return nil, fmt.Errorf("listing service containers for %s/%s: %w", project, service, err)
	}
	return containers, nil
}

// InspectContainer returns detailed info about a container.
func InspectContainer(ctx context.Context, cli *client.Client, id string) (container.InspectResponse, error) {
	resp, err := cli.ContainerInspect(ctx, id)
	if err != nil {
		return container.InspectResponse{}, fmt.Errorf("inspecting container %s: %w", shortID(id), err)
	}
	return resp, nil
}

// StopContainer stops a container. Already-stopped (304) is treated as success.
func StopContainer(ctx context.Context, cli *client.Client, id string) error {
	err := cli.ContainerStop(ctx, id, container.StopOptions{})
	if err != nil && !errdefs.IsNotModified(err) { //nolint:staticcheck
		return fmt.Errorf("stopping container %s: %w", shortID(id), err)
	}
	return nil
}

// RemoveContainer removes a container. Already-removed (404) is treated as success.
func RemoveContainer(ctx context.Context, cli *client.Client, id string) error {
	err := cli.ContainerRemove(ctx, id, container.RemoveOptions{})
	if err != nil && !errdefs.IsNotFound(err) { //nolint:staticcheck
		return fmt.Errorf("removing container %s: %w", shortID(id), err)
	}
	return nil
}

// PullImage pulls a Docker image, streaming high-signal log lines to logFn.
// For localhost registries, registryPassword is used to inject X-Registry-Auth
// so the Docker daemon can authenticate without relying on its credential store
// (e.g. on macOS where keychain credentials are inaccessible via the Docker API).
func PullImage(ctx context.Context, cli *client.Client, imageTag string, logFn func(string), registryPassword string) error {
	opts := image.PullOptions{}
	if isLocalhost(imageTag) {
		auth, err := buildRegistryAuth("rollhook", registryPassword, extractHost(imageTag))
		if err != nil {
			return fmt.Errorf("encoding registry auth: %w", err)
		}
		opts.RegistryAuth = auth
	}

	reader, err := cli.ImagePull(ctx, imageTag, opts)
	if err != nil {
		return fmt.Errorf("docker pull failed: %w", err)
	}
	defer reader.Close()

	return parsePullStream(reader, logFn)
}

// isLocalhost reports whether the image tag references a localhost registry.
func isLocalhost(imageTag string) bool {
	slashIdx := strings.Index(imageTag, "/")
	if slashIdx < 0 {
		return false
	}
	host := imageTag[:slashIdx]
	return strings.HasPrefix(host, "localhost:") || strings.HasPrefix(host, "127.0.0.1:")
}

// extractHost returns the registry host portion of an image tag (e.g. "localhost:7700").
func extractHost(imageTag string) string {
	slashIdx := strings.Index(imageTag, "/")
	if slashIdx < 0 {
		return ""
	}
	return imageTag[:slashIdx]
}

// buildRegistryAuth encodes registry credentials as a base64 JSON string
// suitable for Docker's X-Registry-Auth header or image.PullOptions.RegistryAuth.
func buildRegistryAuth(username, password, serverAddress string) (string, error) {
	authJSON, err := json.Marshal(map[string]string{
		"username":      username,
		"password":      password,
		"serveraddress": serverAddress,
	})
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(authJSON), nil
}

type pullEvent struct {
	Status string `json:"status"`
	Error  string `json:"error"`
}

// parsePullStream reads NDJSON pull output, forwarding high-signal events to logFn.
// Returns an error if the stream contains a Docker pull error event.
func parsePullStream(r io.Reader, logFn func(string)) error {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event pullEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue // skip malformed NDJSON lines
		}
		if event.Error != "" {
			return fmt.Errorf("docker pull failed: %s", event.Error)
		}
		if event.Status != "" {
			for _, prefix := range pullLogPrefixes {
				if strings.HasPrefix(event.Status, prefix) {
					logFn(event.Status)
					break
				}
			}
		}
	}
	return scanner.Err()
}

func shortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}
