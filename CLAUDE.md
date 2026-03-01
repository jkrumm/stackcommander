# RollHook — Project Configuration

## Project Overview

Webhook-driven rolling deployment orchestrator for Docker Compose stacks on self-hosted VPS. Receives GitHub Actions webhook calls, runs zero-downtime rolling deployments via `docker-rollout`, and streams job logs back to CI.

**Stateless design:** No server-side config file needed. RollHook discovers the compose file and service name automatically from the running container's Docker Compose labels (`com.docker.compose.project.config_files` + `com.docker.compose.service`). The `image_tag` is the discovery key — one image = one service.

**Companion repo:** `~/SourceRoot/rollhook-action` (`jkrumm/rollhook-action`) — GitHub Action that triggers deploys and streams SSE logs live to CI. Versioned independently (`v1.x`). Users reference it as `uses: jkrumm/rollhook-action@v1`.

See: `~/Obsidian/Vault/03_Projects/rollhook.md`
North Star Stack: `~/Obsidian/Vault/04_Areas/Engineering/north-star-stack.md`

---

## Monorepo Structure

```
rollhook/
  apps/
    server/                        # @rollhook/server — Elysia API (port 7700)
      src/
        app.ts                     # Bare Elysia app (no .listen()), plugin composition
        api/
          health.ts                # GET /health (no auth)
          deploy.ts                # POST /deploy
          jobs.ts                  # GET /jobs/:id, GET /jobs/:id/logs (SSE), GET /jobs
        middleware/
          auth.ts                  # Bearer token plugin (role: admin | webhook)
        jobs/
          executor.ts              # Main orchestrator: discover → validate → pull → rollout → notify
          steps/discover.ts        # docker ps + docker inspect to find compose_path + service
          steps/pull.ts            # docker pull <image>
          steps/validate.ts        # Pre-deploy: check compose_path is absolute + exists
          steps/rollout.ts         # TypeScript rolling deploy (scale-up → health poll → drain old)
          notifier.ts              # Pushover + configurable webhook (NOTIFICATION_WEBHOOK_URL env var)
          queue.ts                 # In-memory job queue (Bun-native)
        db/
          client.ts                # bun:sqlite instance + auto-migrations
          jobs.ts                  # Job CRUD (insert, get, updateStatus, updateDiscovery)
      server.ts                    # Entry — .listen(7700)
    marketing/                       # @rollhook/marketing — Astro marketing site (port 4321)
  packages/
    rollhook/                # rollhook — public NPM package
      src/
        types.ts                   # Derived TS types: JobResult, JobStatus
        index.ts                   # Re-exports
  data/                            # gitignored
    rollhook.db              # SQLite — job metadata
    logs/                          # data/logs/<job-id>.log — raw job output
  examples/
    infra/
      compose.infra.yml            # Traefik + Alloy + RollHook reference stack
      config.alloy                 # Alloy reference config for log/metrics collection
    bun-hello-world/               # Reference app: compose.yml + healthcheck
  package.json                     # Bun workspace root
  tsconfig.json                    # Root TypeScript 6.0 config (inherited by all packages)
  eslint.config.mjs                # @antfu/eslint-config (flat config, handles formatting too)
```

---

## Tech Stack

| Layer              | Choice                                                                           |
| ------------------ | -------------------------------------------------------------------------------- |
| Runtime            | Bun 1.3.9                                                                        |
| Monorepo           | Bun workspaces (native)                                                          |
| Language           | TypeScript 6.0.0-beta                                                            |
| Backend            | Elysia (Bun-native, OpenAPI, bearer auth plugin)                                 |
| API Docs           | Scalar via `@elysiajs/openapi` at `/openapi`                                     |
| Database           | `bun:sqlite` — `data/rollhook.db`, job metadata                                  |
| Discovery          | Docker REST API — reads compose labels from running containers                   |
| Deployment         | TypeScript rolling deploy via Docker REST API — healthcheck-gated, zero-downtime |
| Linting/Formatting | @antfu/eslint-config (ESLint flat config, no Prettier)                           |

---

## Package Manager

**Bun** — always use `bun` commands.

```bash
# Install all workspace deps from root
bun install

# Add dep to a specific workspace
bun add <pkg> --cwd apps/server
bun add <pkg> --cwd packages/rollhook
```

---

## Scripts

### Root

| Command             | Action                               |
| ------------------- | ------------------------------------ |
| `bun run dev`       | Start Elysia API server on port 7700 |
| `bun run typecheck` | Type-check all workspaces            |
| `bun run lint`      | Lint entire monorepo                 |
| `bun run lint:fix`  | Auto-fix lint + formatting           |

---

## TypeScript

- **Version:** 6.0.0-beta (managed at root, all workspaces inherit)
- `ignoreDeprecations: "6.0"` is set where `baseUrl` is needed (TS6 deprecation)

---

## ESLint / Formatting

Uses `@antfu/eslint-config` — handles both linting AND formatting (no Prettier).

```bash
bun run lint        # Check
bun run lint:fix    # Fix + format
```

---

## Workspace Package Names

| Directory           | Package Name          |
| ------------------- | --------------------- |
| `apps/server`       | `@rollhook/server`    |
| `apps/marketing`    | `@rollhook/marketing` |
| `packages/rollhook` | `rollhook`            |

---

## Elysia Server

| File                                     | Purpose                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| `apps/server/server.ts`                  | Entry point — `.listen(7700)`                              |
| `apps/server/src/app.ts`                 | Bare Elysia app (no `.listen()`) — OpenAPI + route plugins |
| `apps/server/src/api/deploy.ts`          | `POST /deploy` — accepts `image_tag`, enqueues job         |
| `apps/server/src/api/jobs.ts`            | `GET /jobs/:id`, `GET /jobs/:id/logs` (SSE), `GET /jobs`   |
| `apps/server/src/middleware/auth.ts`     | Bearer token plugin — two roles: `admin`, `webhook`        |
| `apps/server/src/db/client.ts`           | `bun:sqlite` instance, auto-migrations                     |
| `apps/server/src/jobs/steps/discover.ts` | Docker REST API — find compose_path/service from labels    |

OpenAPI (Scalar UI): `@elysiajs/openapi` — served at `/openapi`, JSON spec at `/openapi/json`.

---

## Auth

Two bearer token roles, set via environment variables (never in config files):

| Env var         | Role      | Allowed routes                                        |
| --------------- | --------- | ----------------------------------------------------- |
| `ADMIN_TOKEN`   | `admin`   | All routes                                            |
| `WEBHOOK_TOKEN` | `webhook` | `POST /deploy`, `GET /jobs/:id`, `GET /jobs/:id/logs` |

---

## Environment Variables

All configuration via environment variables — no config file:

| Env var                    | Required | Purpose                                      |
| -------------------------- | -------- | -------------------------------------------- |
| `ADMIN_TOKEN`              | yes      | Admin bearer token                           |
| `WEBHOOK_TOKEN`            | yes      | Webhook bearer token                         |
| `DOCKER_HOST`              | no       | Docker socket (default: local socket)        |
| `PUSHOVER_USER_KEY`        | no       | Pushover user key for mobile notifications   |
| `PUSHOVER_APP_TOKEN`       | no       | Pushover app token for mobile notifications  |
| `NOTIFICATION_WEBHOOK_URL` | no       | URL to POST job result JSON to on completion |

---

## SQLite

`bun:sqlite` — `data/rollhook.db`, zero external dependencies.

- Job metadata: id, app, status, image_tag, compose_path, service, error, created_at, updated_at
- `compose_path` and `service` are populated after successful discovery
- Job logs: `data/logs/<job-id>.log` (flat files, SSE-streamed via `GET /jobs/:id/logs`)
- `data/` is gitignored

---

## npm Package `rollhook`

Publishes shared TypeScript types. Published via `/release` skill.

**Exports:**

```ts
export type { JobResult, JobStatus }
```

---

## API Surface

```
POST   /deploy                     # roles: admin, webhook
  Body: { image_tag: string }
  Returns: { job_id, app, status: "queued" }
  app is derived from image_tag: image.split('/').pop().split(':')[0]
  Discovers compose_path + service from running container matching image_tag

GET    /jobs/:id                   # roles: admin, webhook
GET    /jobs/:id/logs              # roles: admin, webhook — SSE stream (text/event-stream)
GET    /jobs?app=&status=&limit=   # role: admin — paginated history
GET    /health                     # no auth
GET    /openapi                    # Scalar UI, no auth
```

---

## Git Workflow

Follow SourceRoot conventions (see `~/SourceRoot/CLAUDE.md`):

- `/commit` for conventional commits
- `/pr` for GitHub PR workflow
- No ticket numbers (personal project)
- No AI attribution
- **NEVER use `!` or `BREAKING CHANGE` in commits** — this is a greenfield project with no external consumers. All changes are `feat:` or `fix:`, never `feat!:`. Major version bumps are forbidden.
