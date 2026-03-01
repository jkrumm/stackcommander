# Group 4: Docker SDK Integration

## What You're Doing

Replace the entire `apps/server/src/docker/` hand-rolled HTTP layer with the official Docker Go SDK. Implement all container operations used by the deploy pipeline: list, inspect, pull (with streaming logs), stop, remove. The SDK handles unix socket plumbing, TLS, and response parsing — you just call typed methods.

---

## Research & Exploration First

1. Read `apps/server/src/docker/client.ts`, `docker/api.ts`, `docker/types.ts` — understand every operation currently used:
   - `listRunningContainers()` — for discovery
   - `listServiceContainers(project, service)` — filtered by compose labels, for rollout
   - `inspectContainer(id)` — for health status during rollout
   - `pullImageStream(imageTag, logFn, xRegistryAuth?)` — streaming pull with NDJSON parsing
   - `stopContainer(id)`, `removeContainer(id)` — for draining old containers
2. Read `apps/server/src/jobs/steps/pull.ts` — see the X-Registry-Auth injection logic for localhost registries
3. Research Docker Go SDK: use Context7 with library `github.com/docker/docker`, query "client ContainerList ImagePull options". Pay attention to: how to connect to the Docker socket, how ImagePull returns an io.ReadCloser (NDJSON stream), how to pass RegistryAuth, filter syntax for label-based container listing.

---

## What to Implement

### 1. `internal/docker/client.go`

```go
package docker

// NewClient creates a Docker client from DOCKER_HOST env or default socket.
// Caller is responsible for closing.
func NewClient() (*client.Client, error) {
    return client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
}
```

### 2. `internal/docker/api.go`

All functions take a `*client.Client` and `context.Context`.

**Container operations:**
```go
func ListRunningContainers(ctx, cli) ([]types.Container, error)

func ListServiceContainers(ctx, cli, project, service string) ([]types.Container, error)
// Use label filters: com.docker.compose.project=<project>, com.docker.compose.service=<service>

func InspectContainer(ctx, cli, id string) (types.ContainerJSON, error)

func StopContainer(ctx, cli, id string) error
// 304 (already stopped) is not an error

func RemoveContainer(ctx, cli, id string) error
// 404 (already removed) is not an error
```

**Image pull:**
```go
func PullImage(ctx, cli, imageTag string, logFn func(string), xRegistryAuth string) error
```

The pull returns an `io.ReadCloser` of NDJSON. Parse each line:
- `{"status": "..."}` — forward to logFn if it's a high-signal event (skip per-layer Downloading/Extracting/Waiting noise)
- `{"error": "..."}` — return as error

High-signal pull events to log (same filter as current TypeScript):
```
"Pulling from", "Pull complete", "Already exists", "Digest:", "Status:"
```

**X-Registry-Auth injection (same logic as TypeScript pull.ts):**

For localhost registries (`localhost:*` or `127.0.0.1:*`), inject credentials:
```go
if isLocalhost(imageTag) {
    auth, _ := json.Marshal(map[string]string{
        "username":      "rollhook",
        "password":      registryPassword, // ROLLHOOK_SECRET
        "serveraddress": extractHost(imageTag),
    })
    xRegistryAuth = base64.StdEncoding.EncodeToString(auth)
}
```

The `registryPassword` parameter is passed in from the caller (not read from env directly in this layer).

---

## Validation

Write integration tests (require a running Docker daemon — skip with `t.Skip()` if `DOCKER_HOST` check fails or socket missing):

```go
func TestListRunningContainers(t *testing.T) {
    // requires Docker socket
}

func TestPullImage(t *testing.T) {
    // pull a tiny image like "hello-world" or "busybox:latest"
    // verify logFn receives at least one call
}
```

Also write unit tests for the helper functions that don't need Docker:
- `isLocalhost("localhost:7700/app:v1")` → true
- `isLocalhost("registry.jkrumm.com/app:v1")` → false
- `extractHost("localhost:7700/app:v1")` → "localhost:7700"
- `parseImageTag("registry.com/app:v2")` → correct fromImage/tag split

```bash
go build ./...
go vet ./...
go test ./internal/docker/...
```

---

## Commit

```
feat(server): replace hand-rolled Docker HTTP layer with official Go SDK
```

---

## Done

Append learning notes to `docs/go-rewrite/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 4
```
