# Group 10: OpenAPI Polish + Orval + README + Final Cleanup

## What You're Doing

Complete the huma operation definitions with full descriptions, examples, and correct response schemas. Configure orval for the dashboard to generate typed React Query hooks from the live spec. Update all documentation to reflect the Go architecture. This is the finish line.

---

## Research & Exploration First

1. Run the Go server and check `/openapi.json` — see what's currently generated and what's missing (descriptions, examples, error responses, SSE endpoint docs)
2. Read `apps/dashboard/package.json` — understand what's already installed and what scripts exist
3. Research orval: use Context7 with `@orval/core` or WebFetch on orval.dev. Focus on: config file format (`orval.config.ts`), React Query mode, how to point at a local OpenAPI spec URL, what it generates
4. Research how to document SSE endpoints in OpenAPI 3.1 — SSE is not formally in the spec, but there are patterns (text/event-stream response, custom extensions)
5. Read `README.md` — understand current state and what needs updating

---

## What to Implement

### 1. Complete huma operation definitions

Every huma-registered operation should have:
- `Summary` — one sentence
- `Description` — what it does, what triggers it, key behaviour
- Correct input/output types with field-level `doc` tags
- Proper error responses (400, 401, 404, 500)

Example for deploy:
```go
huma.Register(api, huma.Operation{
    OperationID: "post-deploy",
    Method:      http.MethodPost,
    Path:        "/deploy",
    Summary:     "Trigger a rolling deployment",
    Description: "Enqueues a zero-downtime rolling deploy for the service matching image_tag. Returns immediately — poll GET /jobs/{id} or stream GET /jobs/{id}/logs for progress.",
    Security:    []map[string][]string{{"bearer": {}}},
    Tags:        []string{"Deploy"},
}, deployHandler)
```

Group all operations with tags: `Deploy`, `Jobs`, `Registry` (for /v2/* — just document it exists).

### 2. SSE endpoint documentation

OpenAPI 3.1 can express SSE as a response with `text/event-stream` content type. Add a custom response type:

```go
type LogStreamOutput struct {
    // huma can't fully model SSE — use a raw response
    Body io.Reader `contentType:"text/event-stream"`
}
```

Add a note in the description: "Server-Sent Events stream. Each event is `data: <log line>`. Stream ends with `data: [DONE]` when job reaches terminal status."

### 3. orval config in `apps/dashboard/`

Install orval:
```bash
bun add -D orval @orval/react-query --cwd apps/dashboard
```

Create `apps/dashboard/orval.config.ts`:
```ts
import { defineConfig } from 'orval'

export default defineConfig({
  rollhook: {
    input: {
      target: 'http://localhost:7700/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: 'src/api/generated',
      schemas: 'src/api/generated/models',
      client: 'react-query',
      override: {
        mutator: {
          path: 'src/api/client.ts',
          name: 'customInstance',
        },
      },
    },
  },
})
```

Create a minimal `apps/dashboard/src/api/client.ts` — a custom axios or fetch instance that injects the `Authorization: Bearer <ROLLHOOK_SECRET>` header. Use an env var (`VITE_ROLLHOOK_SECRET` or however the dashboard is configured).

Add script to `apps/dashboard/package.json`:
```json
"generate:api": "orval"
```

Add to root `package.json`:
```json
"generate:api": "bun run generate:api --cwd apps/dashboard"
```

Run it once and commit the generated output as a baseline.

### 4. Update `CLAUDE.md`

Remove all TypeScript server patterns, Elysia auth gotchas, bun:test patterns. Add:
- Go module structure (`cmd/rollhook`, `internal/`)
- Go validation commands
- The `generate:api` workflow for dashboard types
- The Zot `compat: ["docker2s2"]` note (permanent gotcha worth keeping)
- orval regeneration note: "run `bun run generate:api` after any API changes"

### 5. Update `README.md`

The README likely references the TypeScript stack. Rewrite the technical section:
- Go binary, no runtime dependency
- Embedded Zot registry
- Single ROLLHOOK_SECRET
- Data volume layout
- Quick start compose example

Keep it user-facing — don't document internals. Reference `docs/go-rewrite/PLAN.md` for architecture details.

### 6. Final housekeeping

- Remove any remaining Bun/TypeScript server references from configs
- Check `.gitignore` — add Go build artifacts (`rollhook`, `rollhook-go`) if not already there
- Check `package.json` root scripts — remove any that no longer apply (`dev`, `typecheck`, `lint` for the server package)
- Verify the GitHub Actions release workflow still builds correctly with the new Dockerfile

---

## Validation

```bash
# Go server builds and tests pass:
go build ./...
go vet ./...
go test ./...

# Start server, generate types, verify they compile:
ROLLHOOK_SECRET=test-secret-ok go run ./cmd/rollhook &
sleep 2
bun run generate:api
kill %1

# Dashboard TypeScript compiles with generated types:
bun run typecheck --cwd apps/dashboard

# Full E2E still passes:
bun run test:e2e

# No stale Elysia/Bun server references:
grep -r "elysia\|@rollhook/server\|bun:test" . \
  --include="*.ts" --include="*.go" --include="*.json" \
  --exclude-dir=".git" --exclude-dir="node_modules" \
  --exclude-dir="apps/server" 2>/dev/null | grep -v "docs/" || echo "Clean ✓"
```

---

## Commit

```
feat(dashboard): add orval API client generation from Go OpenAPI spec
docs: update README and CLAUDE.md for Go architecture
```

---

## Done

Write the final `docs/go-rewrite/RALPH_NOTES.md` entry (Group 9) and a brief overall summary section. Then:
```
RALPH_TASK_COMPLETE: Group 10
```
