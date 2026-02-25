# RollHook — Project Configuration

## Project Overview

Webhook-driven rolling deployment orchestrator for Docker Compose stacks on self-hosted VPS. Receives GitHub Actions webhook calls, runs zero-downtime rolling deployments via `docker-rollout`, and streams job logs back to CI.

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
          deploy.ts                # POST /deploy/:app
          jobs.ts                  # GET /jobs/:id, GET /jobs/:id/logs (SSE), GET /jobs
          registry.ts              # GET /registry, PATCH /registry/:app
        middleware/
          auth.ts                  # Bearer token plugin (role: admin | webhook)
        jobs/
          executor.ts              # Main orchestrator: validate → pull → rollout → notify
          steps/pull.ts            # docker pull <image>
          steps/validate.ts        # Pre-deploy: check compose_path is absolute + exists
          steps/rollout.ts         # docker rollout (ordered, healthcheck-gated, IMAGE_TAG via env)
          notifier.ts              # Pushover + configurable webhook
          queue.ts                 # In-memory job queue (Bun-native)
        db/
          client.ts                # bun:sqlite instance + auto-migrations
          jobs.ts                  # Job CRUD (insert, get, updateStatus)
        config/
          loader.ts                # Parse + validate rollhook.config.yaml
          schema.ts                # TypeBox schema for server config
      server.ts                    # Entry — .listen(7700)
      rollhook.config.example.yaml
    marketing/                       # @rollhook/marketing — Astro marketing site (port 4321)
  packages/
    rollhook/                # rollhook — public NPM package
      src/
        schema/
          config.ts                # TypeBox schema for rollhook.config.yaml
        types.ts                   # Derived TS types: ServerConfig, JobResult
        index.ts                   # Re-exports
      schema/
        config.json                # Generated JSON Schema (from TypeBox)
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

| Layer              | Choice                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Runtime            | Bun 1.3.9                                                                                  |
| Monorepo           | Bun workspaces (native)                                                                    |
| Language           | TypeScript 6.0.0-beta                                                                      |
| Backend            | Elysia (Bun-native, OpenAPI, bearer auth plugin)                                           |
| API Docs           | Scalar via `@elysiajs/openapi` at `/openapi`                                               |
| Database           | `bun:sqlite` — `data/rollhook.db`, job metadata                                            |
| Config             | YAML (`rollhook.config.yaml`) + Zod validation                                             |
| Schema             | TypeBox (`@sinclair/typebox`) — schemas are valid JSON Schema natively, no conversion step |
| Deployment         | `docker-rollout` — zero-downtime rolling updates                                           |
| Linting/Formatting | @antfu/eslint-config (ESLint flat config, no Prettier)                                     |

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

| File                                 | Purpose                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| `apps/server/server.ts`              | Entry point — `.listen(7700)`                              |
| `apps/server/src/app.ts`             | Bare Elysia app (no `.listen()`) — OpenAPI + route plugins |
| `apps/server/src/api/deploy.ts`      | `POST /deploy/:app` — accepts `image_tag`, enqueues job    |
| `apps/server/src/api/jobs.ts`        | `GET /jobs/:id`, `GET /jobs/:id/logs` (SSE), `GET /jobs`   |
| `apps/server/src/api/registry.ts`    | `GET /registry`, `PATCH /registry/:app`                    |
| `apps/server/src/middleware/auth.ts` | Bearer token plugin — two roles: `admin`, `webhook`        |
| `apps/server/src/db/client.ts`       | `bun:sqlite` instance, auto-migrations                     |
| `apps/server/src/config/loader.ts`   | Parse + validate `rollhook.config.yaml`                    |

OpenAPI (Scalar UI): `@elysiajs/openapi` — served at `/openapi`, JSON spec at `/openapi/json`.

---

## Auth

Two bearer token roles, set via environment variables (never in config files):

| Env var         | Role      | Allowed routes           |
| --------------- | --------- | ------------------------ |
| `ADMIN_TOKEN`   | `admin`   | All routes               |
| `WEBHOOK_TOKEN` | `webhook` | `POST /deploy/:app` only |

---

## Config

`rollhook.config.yaml` — server config on the VPS, gitignored real file.

```yaml
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/rollhook/schema/config.json
apps:
  - name: my-api
    compose_path: /srv/stacks/my-api/compose.yml
    steps:
      - service: backend
notifications:
  webhook: '' # optional — POST job result JSON here on completion
```

Pushover credentials are **not** in the config file — they come from environment variables: `PUSHOVER_USER_KEY` and `PUSHOVER_APP_TOKEN`.

Parsed and validated at startup via `apps/server/src/config/loader.ts` using `ServerConfigSchema` from `packages/rollhook/src/schema/config.ts`.

An example file lives at `apps/server/rollhook.config.example.yaml`.

---

## SQLite

`bun:sqlite` — `data/rollhook.db`, zero external dependencies.

- Job metadata: id, app, status, image_tag, created_at, updated_at
- Job logs: `data/logs/<job-id>.log` (flat files, SSE-streamed via `GET /jobs/:id/logs`)
- `data/` is gitignored

---

## YAML Schema Conventions

Config files are YAML validated by TypeBox schemas. TypeBox produces valid JSON Schema natively — no conversion library needed. Schemas are published in the `rollhook` npm package and served via jsDelivr CDN.

### `rollhook.config.yaml` (server config)

- TypeBox schema: `packages/rollhook/src/schema/config.ts`
- JSON Schema: `packages/rollhook/schema/config.json`
- CDN: `https://cdn.jsdelivr.net/npm/rollhook/schema/config.json`

---

## npm Package `rollhook`

Primarily a schema delivery mechanism — published to npm so JSON Schemas are served via jsDelivr CDN. Schemas are defined in TypeBox (already in the stack via Elysia) which produces valid JSON Schema natively — no conversion library needed. The server imports the same TypeBox schemas directly for Elysia route validation. Published via `/release` skill.

**Exports:**

```ts
export { ServerConfigSchema } // TypeBox schemas (= JSON Schema objects)
export type { JobResult, ServerConfig } // Static<typeof Schema> derived types
```

**`package.json` exports:**

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./schema/config": "./schema/config.json"
  }
}
```

JSON Schema files served via jsDelivr CDN from npm — no custom domain needed.

---

## API Surface

```
POST   /deploy/:app                # roles: admin, webhook
  Body: { image_tag: string }
  Returns: { job_id, app, status: "queued" }

GET    /jobs/:id                   # role: admin
GET    /jobs/:id/logs              # role: admin — SSE stream (text/event-stream)
GET    /jobs?app=&status=&limit=   # role: admin — paginated history
GET    /registry                   # role: admin — apps + last deploy
PATCH  /registry/:app              # role: admin — update app config
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
