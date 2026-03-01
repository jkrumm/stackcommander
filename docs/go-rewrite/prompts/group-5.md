# Group 5: Zot Process Manager + OCI Proxy

## What You're Doing

Port the Zot subprocess manager and OCI reverse proxy to Go. The manager starts Zot as a child process, polls until ready, and pipes logs with line-buffering. The proxy uses `httputil.ReverseProxy` — this is the group that eliminates the body-buffering limitation of the TypeScript implementation. Native streaming, no `io.ReadAll` on request bodies.

---

## Research & Exploration First

1. Read `apps/server/src/registry/manager.ts` — understand startup, health polling, log piping, graceful stop
2. Read `apps/server/src/registry/config.ts` — understand Zot config JSON structure, htpasswd format, the `compat: ["docker2s2"]` requirement (critical — without this Zot rejects Docker v2 manifests)
3. Read `apps/server/src/registry/proxy.ts` — understand auth validation (Bearer + Basic), hop-by-hop headers to strip, Location header rewriting, the 401/WWW-Authenticate response
4. Research `httputil.ReverseProxy` in Go stdlib — understand `Director` func, `ModifyResponse` func, how it handles request body (it uses `io.Copy` — naturally streaming). Check if there are known issues with chunked transfer encoding.
5. Research `golang.org/x/crypto/bcrypt` — cost factor, hash format (`$2a$` vs `$2b$` — Zot's Go bcrypt accepts both)

---

## What to Implement

### 1. `internal/registry/config.go`

```go
const ZotUser = "rollhook"

func ZotPassword(secret string) string { return secret }

func GenerateZotConfig(storageRoot, htpasswdPath string, port int) string
// Returns JSON config with:
// - distSpecVersion: "1.1.1"
// - http.address: "127.0.0.1"
// - http.port: string(port)
// - http.auth.htpasswd.path: htpasswdPath
// - http.compat: ["docker2s2"]   ← CRITICAL: without this, docker push fails with 415
// - storage.rootDirectory: storageRoot
// - log.level: "info"

func GenerateHtpasswd(password string) (string, error)
// bcrypt cost 10-12, returns "rollhook:<hash>\n"
```

### 2. `internal/registry/manager.go`

```go
type Manager struct { /* unexported fields */ }

func NewManager(dataDir, secret string) *Manager

func (m *Manager) Start(ctx context.Context) error
// 1. mkdir -p dataDir/registry/
// 2. Write config.json and .htpasswd
// 3. os.Exec("zot", "serve", configPath) with stdout/stderr piped
// 4. Start line-buffered log forwarder goroutine (prefix "[zot] ")
// 5. Poll http://127.0.0.1:5000/v2/ until 200 or 401 (max 10s)
// 6. Return nil when ready

func (m *Manager) Stop() error
// Send SIGTERM to zot process, wait for exit (max 5s)

func (m *Manager) IsRunning() bool

func (m *Manager) Credentials() (user, password string)
// Returns ZotUser, ROLLHOOK_SECRET — deterministic
```

**Line-buffered log forwarder** (fix the mid-line split issue from TypeScript):
```go
scanner := bufio.NewScanner(stdout)
for scanner.Scan() {
    slog.Info(scanner.Text(), "source", "zot")
}
```

### 3. `internal/registry/proxy.go`

```go
func NewProxy(zotAddr, secret string) http.Handler
// Returns an http.Handler that:
// 1. Validates Authorization header (Bearer or Basic, password = secret)
//    - 401 + WWW-Authenticate: Basic realm="RollHook Registry" if invalid
// 2. Strips hop-by-hop headers from request
// 3. Proxies to zotAddr via httputil.ReverseProxy
// 4. ModifyResponse: rewrite Location headers from absolute zot URLs to relative paths
//    e.g. "http://127.0.0.1:5000/v2/..." → "/v2/..."

// Auth validation — same logic as TypeScript proxy.ts:
// Bearer: token == secret
// Basic: base64decode → split at first ":" → password == secret (any username)
func validateProxyAuth(header, secret string) bool
```

**Hop-by-hop headers to strip** (same set as TypeScript):
```
authorization, host, transfer-encoding, connection, keep-alive,
proxy-authenticate, proxy-authorization, te, trailers, upgrade
```

**Routing in main.go** — register the proxy for all OCI distribution routes:
```go
r.Handle("/v2", proxyHandler)
r.Handle("/v2/", proxyHandler)
r.Handle("/v2/*", proxyHandler)
```
Chi's wildcard works correctly for nested paths (unlike Elysia 1.4's broken `.all()`).

---

## Validation

```go
// Unit tests for config.go:
func TestGenerateZotConfig_ContainsDockerCompat(t *testing.T)  // compat: ["docker2s2"] present
func TestGenerateZotConfig_LoopbackAddress(t *testing.T)        // 127.0.0.1
func TestGenerateHtpasswd_Format(t *testing.T)                  // rollhook:$2... prefix
func TestGenerateHtpasswd_VerifiesCorrectly(t *testing.T)       // bcrypt.CompareHashAndPassword

// Unit tests for proxy auth:
func TestValidateProxyAuth_Bearer(t *testing.T)
func TestValidateProxyAuth_Basic_AnyUsername(t *testing.T)
func TestValidateProxyAuth_InvalidToken(t *testing.T)
func TestValidateProxyAuth_Missing(t *testing.T)
```

Manual smoke test (integration — requires Zot binary in PATH or Docker image):
```bash
# Start Go server with ROLLHOOK_SECRET set
ROLLHOOK_SECRET=test-secret-ok go run ./cmd/rollhook &
sleep 3

# Zot proxy should respond:
curl -s http://localhost:7700/v2/ -I
# → 401 with WWW-Authenticate header

curl -s -u rollhook:test-secret-ok http://localhost:7700/v2/ -I
# → 200

kill %1
```

```bash
go build ./...
go vet ./...
go test ./internal/registry/...
```

---

## Security Notes

- Zot binds `127.0.0.1` exclusively — never reachable externally
- `.htpasswd` file permissions: set `0600` after writing (`os.Chmod`)
- `config.json` permissions: set `0600` after writing
- bcrypt cost 12 is fine for a startup-once password hash

---

## Commit

```
feat(server): add Zot process manager and streaming OCI proxy
```

---

## Done

Append learning notes to `docs/go-rewrite/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 5
```
