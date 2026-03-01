# Group 2: Auth Middleware + OpenAPI + Scalar

## What You're Doing

Add bearer token authentication middleware, wire huma v2 for OpenAPI 3.1 generation on top of Chi, and serve Scalar API docs at `/openapi`. All protected routes return 401 without a valid token. The OpenAPI spec is machine-readable at `/openapi.json` — this will be consumed by orval in Group 9 to generate dashboard types.

---

## Research & Exploration First

1. Read `apps/server/src/middleware/auth.ts` — see what the current auth does and what the 401 response looks like (match the response shape)
2. Read `apps/server/src/app.ts` — see how OpenAPI was configured with `@elysiajs/openapi` and what info fields were set (title, description, version)
3. Research huma v2 Chi adapter — use Context7 with `resolve-library-id` for `github.com/danielgtaylor/huma/v2`, then `query-docs` for "chi adapter openapi security scheme". Focus on: how to register a security scheme, how to mark operations as requiring auth, how to serve the spec.
4. Check if huma v2 supports Scalar out of the box or if you need to serve a custom HTML file

---

## What to Implement

### 1. `internal/middleware/auth.go`

Standard `http.Handler` middleware — no framework coupling:

```go
package middleware

func RequireAuth(secret string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
            if token != secret {
                w.Header().Set("Content-Type", "application/json")
                w.WriteHeader(http.StatusUnauthorized)
                json.NewEncoder(w).Encode(map[string]string{
                    "error": "unauthorized",
                })
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

### 2. huma v2 + Chi wiring in `cmd/rollhook/main.go`

Wire huma on top of Chi. Set API metadata (title, description, version). Register the bearer security scheme so protected operations show the lock icon in Scalar.

Register the existing `/health` endpoint through huma so it appears in the spec — but without the security requirement.

### 3. Scalar at `/openapi`

huma can serve Swagger UI natively. For Scalar, serve a small HTML file. Scalar's CDN script approach:

```html
<!doctype html>
<html>
<head><title>RollHook API</title><meta charset="utf-8"/></head>
<body>
<script id="api-reference" data-url="/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
```

You can embed this as a Go string constant or a small `//go:embed` file. Keep it simple.

### 4. Placeholder huma operations for protected routes

Register stub operations for the routes that will be fully implemented in later groups. The stubs should return 501 Not Implemented but exist in the spec with correct paths, methods, and security requirements:

- `POST /deploy` — protected
- `GET /jobs` — protected
- `GET /jobs/{id}` — protected
- `GET /jobs/{id}/logs` — protected

This way the spec is immediately useful and Scalar shows the full planned API surface.

---

## Validation

```bash
go build ./...
go vet ./...
go test ./internal/middleware/...

# Start server and smoke test:
ROLLHOOK_SECRET=test-secret go run ./cmd/rollhook &
sleep 1

# Auth works:
curl -s http://localhost:7700/health | jq .
# → {"status":"ok","version":"dev"}

curl -s http://localhost:7700/jobs | head -5
# → 401 unauthorized (no auth)

curl -s -H "Authorization: Bearer test-secret" http://localhost:7700/jobs | head -5
# → 501 (stub) or similar — NOT 401

# Spec exists:
curl -s http://localhost:7700/openapi.json | jq '.info.title'
# → "RollHook"

# Scalar renders (just check it returns HTML):
curl -s http://localhost:7700/openapi | grep -i scalar

kill %1
```

Write a unit test for auth middleware covering: no header → 401, wrong token → 401, correct token → passes through.

---

## Commit

```
feat(server): add auth middleware, huma OpenAPI 3.1, and Scalar docs
```

---

## Done

Append learning notes to `docs/go-rewrite/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 2
```
