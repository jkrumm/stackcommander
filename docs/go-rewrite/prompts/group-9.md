# Group 9: Dockerfile Cutover + E2E Quality Pass

## What You're Doing

Switch the Dockerfile CMD to the Go binary, delete the Bun server, and run the full E2E suite against the Go implementation. This group is **not** "make the tests pass by any means" — it's a quality gate that uses failing tests as signal to improve the implementation. Think of it the way Cloudflare used Next.js's test suite when rewriting in Vite: the tests describe the contract, not the implementation. When a test fails, ask why — fix the Go server if it's wrong, but update the test if it was testing a TypeScript quirk, not a behaviour.

---

## Research & Exploration First

1. Read `e2e/tests/*.test.ts` — every test file before touching anything. Categorise them by what they're actually testing (auth contract, deploy flow, SSE format, timing, etc.)
2. Read `e2e/setup/global.ts` — understand the full setup: Docker build, compose up, image push, hello-world start
3. Read `e2e/setup/fixtures.ts` — `pollJobUntilDone`, `getContainerCount`, token constants
4. Read `e2e/compose.e2e.yml` — how the RollHook container is started (env vars, volumes, socket mount)
5. Read the current Dockerfile top-to-bottom — understand what Bun-specific build steps exist that can be removed

---

## Step 1: Dockerfile Cutover

Switch CMD and clean up the Bun runtime from the runner stage:

```dockerfile
# Remove all Bun-specific runner stage content:
# - COPY package.json, bun.lock
# - COPY apps/server/package.json, apps/dashboard/package.json, etc.
# - RUN bun install
# - COPY packages/rollhook, apps/server, tsconfig.json

# Keep:
# - tool-downloader stage (Zot binary, Docker CLI) — unchanged
# - go-builder stage (from Group 1) — unchanged
# - runner stage: copy binaries only

FROM oven/bun:1.3.9-slim AS runner   # <-- consider switching base to debian:slim or alpine
                                     #     since Bun runtime is no longer needed
WORKDIR /app
COPY --from=tool-downloader /usr/local/bin/docker /usr/local/bin/docker
COPY --from=tool-downloader /usr/local/lib/docker/cli-plugins /usr/local/lib/docker/cli-plugins
COPY --from=tool-downloader /usr/local/bin/zot /usr/local/bin/zot
COPY --from=go-builder /rollhook /usr/local/bin/rollhook

RUN mkdir -p /app/data

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD ["/bin/sh", "-c", "wget -qO- http://localhost:7700/health || exit 1"]
  # or use the Go binary itself if it has a built-in health check subcommand

EXPOSE 7700
CMD ["/usr/local/bin/rollhook"]
```

Consider whether to keep `oven/bun:1.3.9-slim` as the base image or switch to something smaller now that Bun isn't needed at runtime. `debian:12-slim` or `alpine:3.21` are good candidates. Alpine requires the Go binary to be built with CGO_ENABLED=0 (already the case).

### Delete `apps/server/`

```bash
rm -rf apps/server/
```

Remove from `package.json` workspaces if listed.

---

## Step 2: Run E2E File by File

Build the new image first:
```bash
docker build -t rollhook-e2e-server:latest -f Dockerfile .
```

Then run tests in order of increasing complexity — fix failures before moving to the next file:

```bash
# Start with the simplest
bun run test:e2e -- --testPathPattern="health"
bun run test:e2e -- --testPathPattern="auth"
bun run test:e2e -- --testPathPattern="registry-proxy"
bun run test:e2e -- --testPathPattern="deploy"
bun run test:e2e -- --testPathPattern="failure"
bun run test:e2e -- --testPathPattern="jobs"
bun run test:e2e -- --testPathPattern="queue"
bun run test:e2e -- --testPathPattern="zero-downtime"
```

(Check the exact Vitest flag for filtering — may be `--reporter` or `--testNamePattern`.)

---

## Step 3: Triage Each Failure

For every failing test, apply this decision tree before touching any code:

**1. Understand the failure:**
Read the assertion. What is the test actually checking — the behaviour or a TypeScript implementation detail?

**2. Is the Go implementation wrong?**
Examples of "fix Go":
- Wrong HTTP status code
- Missing JSON field in response
- SSE `[DONE]` event not sent
- Wrong Content-Type header
- Auth header not enforced on a route it should be

**3. Is the test testing a quirk, not a contract?**
Examples of "update the test":
- Test expects a specific error message string that was hardcoded in TypeScript — Go uses a different (but equally correct) message
- Test checks an exact timing that was tuned for Bun's event loop
- Test asserts an internal implementation detail (e.g. specific log line format) that isn't part of the API contract
- Test was validating against a `registry:2` behaviour that no longer exists

**4. Is this an improvement opportunity?**
Examples:
- Go returns more structured error responses → update test to assert the better format
- Go's SSE stream has cleaner event separation → verify tests still catch the essentials
- Go correctly validates something TypeScript was lenient about → the stricter behaviour is better, update the test

**Document every deviation** — in `docs/go-rewrite/RALPH_NOTES.md`, list every test that was updated and the reason. This is the learning log.

---

## Step 4: Full Suite

Once all individual files pass, run the complete suite:

```bash
bun run test:e2e
```

Target: **56 pass, 0 fail.** If the count changes (some tests consolidated, some added), that's fine — document it.

---

## Validation

```bash
# Go binary is clean
go build ./...
go vet ./...
go test ./...

# Bun server is gone
test ! -d apps/server && echo "apps/server deleted ✓"

# Docker image builds with Go binary
docker build -t rollhook-test:latest -f Dockerfile .

# Full E2E
bun run test:e2e
# → all pass
```

---

## Commit

Two commits:

```
refactor(docker): switch base image to Go binary, remove Bun runtime
```

```
refactor(server): delete Bun/Elysia server (apps/server)
```

If any E2E tests were updated, add a third:
```
test(e2e): update tests to reflect Go implementation behaviour
```

---

## Done

In `docs/go-rewrite/RALPH_NOTES.md`, specifically document:
- Which tests needed Go fixes (implementation was wrong)
- Which tests were updated (were testing TS quirks, not contracts)
- Any improvements discovered from the E2E failure analysis
- Final test count

Then:
```
RALPH_TASK_COMPLETE: Group 9
```
