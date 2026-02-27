# RollHook

**Zero-downtime rolling Docker Compose deployments via webhooks.**

[![npm](https://img.shields.io/npm/v/rollhook)](https://www.npmjs.com/package/rollhook)
[![Docker](https://img.shields.io/badge/docker-registry.jkrumm.com%2Frollhook-blue)](https://registry.jkrumm.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it is

RollHook receives a webhook from your CI pipeline, pulls the new image, and rolls it
out across your Docker Compose service — one container at a time, waiting for each
healthcheck to pass before proceeding.

Configure via YAML. Integrate in one CI step. No dashboard, no provisioning, no vendor.

### Scope

RollHook handles rolling deployments. It does not:

- Build or push images (that's your CI — GitHub Actions, Docker Buildx)
- Manage DNS, TLS, or routing (that's your reverse proxy — Caddy, Traefik, nginx)
- Provision or configure servers
- Replace a full PaaS if you need multi-tenant ops

A deployment monitoring dashboard and multi-VPS support are on the roadmap.

---

## Architecture

```mermaid
flowchart LR
    GH[GitHub Actions]
    SC[RollHook\nport 7700]
    PR[Reverse proxy\nCaddy / Traefik / nginx]
    APP[App containers]

    GH -->|POST /deploy/:app\nimage_tag| SC
    SC -->|rolling update| APP
    PR -->|route traffic via\nDocker DNS| APP
    SC -->|SSE log stream| GH
```

Your reverse proxy routes traffic to app containers via Docker's internal DNS — the service name resolves to all active containers automatically. During a rollout, old and new containers coexist briefly; the proxy load-balances between them until the old one is removed. RollHook orchestrates the deployment sequence and reports results.

---

## Infra Setup

RollHook runs alongside your existing reverse proxy — Caddy, Traefik, nginx, or any other. No proxy-specific configuration is required. Reference infra configurations are in [`examples/infra/`](examples/infra/):

| File                | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `compose.infra.yml` | Traefik + Alloy + RollHook reference stack        |
| `config.alloy`      | Alloy reference config for log/metrics collection |

---

## Quick Start

### 1. Run RollHook

The recommended setup uses a [socket proxy](https://github.com/Tecnativa/docker-socket-proxy) to limit Docker socket exposure. RollHook communicates with Docker via `DOCKER_HOST=tcp://socket-proxy:2375` instead of a direct socket mount — no host path dependency, no distro-specific plugin paths.

```yaml
# docker-compose.yml (on your VPS)
services:
  socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    restart: unless-stopped
    environment:
      CONTAINERS: 1
      SERVICES: 1
      IMAGES: 1
      INFO: 1
      POST: 1 # required: RollHook issues write operations (scale, pull)
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - socket-proxy-net

  rollhook:
    image: registry.jkrumm.com/rollhook:latest
    restart: unless-stopped
    depends_on:
      - socket-proxy
    environment:
      ADMIN_TOKEN: ${ADMIN_TOKEN}
      WEBHOOK_TOKEN: ${WEBHOOK_TOKEN}
      DOCKER_HOST: tcp://socket-proxy:2375
      # Optional: Pushover mobile notifications
      # PUSHOVER_USER_KEY: ${PUSHOVER_USER_KEY}
      # PUSHOVER_APP_TOKEN: ${PUSHOVER_APP_TOKEN}
    volumes:
      - ./rollhook.config.yaml:/app/rollhook.config.yaml:ro
      - rollhook-data:/app/data
      # Mount one directory per deployed app (read-only):
      # - /srv/stacks/my-api:/srv/stacks/my-api:ro
    networks:
      - socket-proxy-net
      - proxy # your reverse proxy network

networks:
  socket-proxy-net:
    internal: true # isolated — only rollhook can reach socket-proxy
  proxy:
    external: true

volumes:
  rollhook-data:
```

> **Minimal alternative:** replace the socket proxy with a direct socket mount and remove the `socket-proxy` service and `socket-proxy-net` network. Simpler, but gives RollHook full Docker socket access. See [Security](#security) for the threat model.
>
> ```yaml
> volumes:
>   - /var/run/docker.sock:/var/run/docker.sock
> ```

### 2. Configure apps

```yaml
# rollhook.config.yaml (on your VPS, gitignored)
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/rollhook/schema/config.json
apps:
  - name: my-api
    compose_path: /srv/stacks/my-api/compose.yml
    steps:
      - service: backend
  - name: my-frontend
    compose_path: /srv/stacks/my-frontend/compose.yml
    steps:
      - service: frontend

notifications:
  webhook: https://hooks.example.com/deployments # optional
```

### 3. Configure your `compose.yml` for zero-downtime deployments

See the [compose.yml requirements](#composeyml-requirements) section below.

### 4. Trigger a deploy

```bash
curl -X POST https://your-vps:7700/deploy/my-api \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"image_tag": "ghcr.io/you/my-api:abc123"}'

# → blocks until complete
# → {"job_id": "...", "app": "my-api", "status": "success"}
# → HTTP 500 + error field on failure
```

Add `?async=true` to return immediately with `"status": "queued"` instead.

Stream logs (admin only):

```bash
curl -N https://your-vps:7700/jobs/<job_id>/logs \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## `compose.yml` requirements

For zero-downtime deployments to work correctly, each service must satisfy:

1. **No `ports:` mapping** — your reverse proxy routes traffic via Docker's internal DNS; `ports:` prevents scaling to multiple instances
2. **No `container_name:`** — fixed names prevent the scaler from creating a second instance
3. **A `healthcheck:`** — the deployment waits for the new instance to be healthy before removing the old one
4. **On the same Docker network as your proxy** — so the proxy can reach the service by its DNS name (e.g. `backend:3000`)

Minimal example:

```yaml
services:
  backend:
    image: ${IMAGE_TAG:-registry.example.com/my-api:latest}
    healthcheck:
      test: [CMD, curl, -f, http://localhost:3000/health]
      interval: 5s
      timeout: 5s
      start_period: 10s
      retries: 5
    networks:
      - proxy

networks:
  proxy:
    external: true
```

**How zero-downtime works without proxy config changes:** Docker's embedded DNS resolves the service name (`backend`) to all active containers in that service. During a rollout, old and new containers coexist — your proxy load-balances between them automatically. Once the old container is removed, only the new one remains. No dynamic discovery or label-watching required.

**Traefik users:** Add [active health check labels](https://doc.traefik.io/traefik/routing/services/#health-check) so Traefik stops routing to the draining container immediately rather than waiting on passive checks. See [`examples/infra/`](examples/infra/) for a reference stack.

**Image tag pattern:** use `${IMAGE_TAG:-registry.example.com/my-api:latest}` in `compose.yml`. RollHook passes `IMAGE_TAG=<full-uri>` as an inline environment variable when invoking `docker rollout` — no `.env` file is written or required.

---

## Graceful shutdown (required for zero-downtime)

Your application **must** handle `SIGTERM` gracefully to avoid 502 errors during the container swap. Without this, the load balancer may route requests to an instance that has already stopped accepting connections.

The pattern:

1. On `SIGTERM`: return `503` from your health endpoint — the load balancer stops routing new requests
2. Wait briefly for the load balancer to deregister (2–3 seconds covers the health check polling interval)
3. Finish in-flight requests, then exit

**Example (Bun):**

```ts
import process from 'node:process'

let isShuttingDown = false

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === '/health')
      return new Response(isShuttingDown ? 'shutting down' : 'ok', { status: isShuttingDown ? 503 : 200 })
    // ... your routes
  },
})

process.on('SIGTERM', async () => {
  isShuttingDown = true
  // Give Traefik time to deregister this instance (healthcheck interval + buffer)
  await new Promise(resolve => setTimeout(resolve, 3000))
  await server.stop(true) // drain in-flight requests
  process.exit(0)
})
```

**Example (Node/Express):**

```ts
import process from 'node:process'
import express from 'express'

let isShuttingDown = false
const app = express()

app.get('/health', (_, res) => {
  res.status(isShuttingDown ? 503 : 200).send(isShuttingDown ? 'shutting down' : 'ok')
})

const server = app.listen(3000)

process.on('SIGTERM', () => {
  isShuttingDown = true
  setTimeout(() => {
    server.close(() => process.exit(0))
  }, 3000)
})
```

See [`examples/bun-hello-world/`](examples/bun-hello-world/) for a complete working reference.

---

## API

Interactive docs at `/openapi` (Scalar UI). Key routes:

| Method  | Route            | Auth           | Description                                                                                                  |
| ------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `POST`  | `/deploy/:app`   | webhook, admin | Trigger rolling deployment                                                                                   |
| `GET`   | `/jobs/:id`      | admin          | Job status + metadata                                                                                        |
| `GET`   | `/jobs/:id/logs` | admin          | SSE log stream                                                                                               |
| `GET`   | `/jobs`          | admin          | Paginated job history (`?app=&status=&limit=`)                                                               |
| `GET`   | `/registry`      | admin          | All registered apps + last deploy                                                                            |
| `PATCH` | `/registry/:app` | admin          | Update app config at runtime                                                                                 |
| `GET`   | `/health`        | none           | Returns `200 { "status": "ok", "version": "1.2.3" }` — suitable for Uptime Kuma, Traefik health checks, etc. |
| `GET`   | `/openapi`       | none           | Scalar API docs                                                                                              |

**Auth:** `Authorization: Bearer <token>` header.

- `WEBHOOK_TOKEN` — deploy endpoint only
- `ADMIN_TOKEN` — all endpoints

---

## Notifications

RollHook sends notifications on deployment completion (success or failure).

**Pushover** (mobile push): set environment variables on the server process:

```bash
PUSHOVER_USER_KEY=your-user-key
PUSHOVER_APP_TOKEN=your-app-token
```

**Webhook**: set `notifications.webhook` in `rollhook.config.yaml`. RollHook POSTs the full job result JSON to that URL on completion.

Notification failures are written to the job log — they never affect job status.

---

## Environment Variables

| Variable               | Required | Description                                                                                     |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `ADMIN_TOKEN`          | yes      | Bearer token for admin API access                                                               |
| `WEBHOOK_TOKEN`        | yes      | Bearer token for deploy webhook calls                                                           |
| `DOCKER_HOST`          | no       | Docker daemon endpoint (e.g. `tcp://socket-proxy:2375`). Defaults to the local socket if unset. |
| `PORT`                 | no       | Port to listen on (default: `7700`)                                                             |
| `ROLLHOOK_CONFIG_PATH` | no       | Absolute path to config file (default: `rollhook.config.yaml` in CWD)                           |
| `PUSHOVER_USER_KEY`    | no       | Pushover user key for mobile notifications                                                      |
| `PUSHOVER_APP_TOKEN`   | no       | Pushover app token for mobile notifications                                                     |

---

## Security

### Threat model

When using a direct socket mount, RollHook has effective root access on the Docker host via `/var/run/docker.sock`. A compromised `WEBHOOK_TOKEN` means an attacker can trigger arbitrary deployments with any image tag — treat it with the same sensitivity as an SSH private key.

### Docker socket access

**Recommended: socket proxy**

Use [Tecnativa's docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) to restrict Docker API access to only the operations RollHook requires. Set `DOCKER_HOST=tcp://socket-proxy:2375` on RollHook and isolate the proxy on an internal network. Required permissions: `CONTAINERS=1 SERVICES=1 IMAGES=1 INFO=1 POST=1`.

This approach also eliminates the distro-specific CLI plugin path problem: with `DOCKER_HOST` set, RollHook uses the Docker CLI bundled in the image to connect over TCP — no host bind mounts for docker-compose or docker-rollout needed.

**Alternative: direct socket mount**

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

Simpler to configure but gives RollHook unrestricted Docker access. Acceptable for single-tenant VPS setups where the threat model is primarily external. The socket proxy is the better default for anything production-facing.

### Token generation

Generate strong tokens with:

```bash
openssl rand -hex 32
```

### HTTPS required

Never expose port 7700 directly to the internet. Always place RollHook behind a reverse proxy with TLS termination — Cloudflare Tunnel, Caddy, Traefik, or nginx. Plaintext HTTP exposes your bearer token on every request.

### Admin endpoint scope

`ADMIN_TOKEN` should never leave the server — it has full API access including job logs and registry mutation. If you run behind a reverse proxy, consider blocking `/jobs`, `/registry`, and `/openapi` from external networks and only exposing `/deploy` and `/health` to CI.

`WEBHOOK_TOKEN` is the only credential that needs to exist in CI secrets. It is scoped to `POST /deploy/:app` only.

### Bun baseline image

The Docker image uses `oven/bun:1.3.9-slim` (the x86_64 baseline variant) intentionally. This ensures compatibility across older x86_64 hardware without AVX2. Modern CPUs incur no meaningful performance difference for this workload.

### Future

HMAC-SHA256 webhook signature verification (`X-Hub-Signature-256`) is planned as an optional hardening layer once a native GitHub Actions workflow is provided. This will let callers sign the exact payload with a shared secret, adding defense-in-depth against token-only leakage.

---

## Volume Mounts (when running in Docker)

| Path                        | Purpose                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `/app/rollhook.config.yaml` | Server config (mount as read-only)                                                  |
| `/app/data`                 | SQLite DB + job logs (persist across restarts)                                      |
| `/var/run/docker.sock`      | Docker socket — only when using direct socket mount (not needed with `DOCKER_HOST`) |
| `/host/path/to/app`         | App compose file directories (one read-only mount per deployed app)                 |

---

## `rollhook` npm Package

The `rollhook` npm package is primarily a schema delivery mechanism — schemas are served via jsDelivr CDN for YAML editor validation.

| Schema                 | URL                                                        |
| ---------------------- | ---------------------------------------------------------- |
| `rollhook.config.yaml` | `https://cdn.jsdelivr.net/npm/rollhook/schema/config.json` |

Add the `# yaml-language-server: $schema=...` comment at the top of your config file for IDE validation.

```ts
// Optional: programmatic validation in your tooling
import type { ServerConfig } from 'rollhook'
import { ServerConfigSchema } from 'rollhook'
```

---

## GitHub Actions integration

```yaml
- name: Deploy
  run: |
    curl -sf -X POST ${{ secrets.ROLLHOOK_URL }}/deploy/my-api \
      -H "Authorization: Bearer ${{ secrets.WEBHOOK_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d '{"image_tag": "${{ env.REGISTRY }}/my-api:${{ github.sha }}"}'
```

---

## Testing

### Commands

| Command                 | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `bun run test`          | Unit tests (bun:test, no Docker required)      |
| `bun run test:coverage` | Unit tests with per-file coverage table        |
| `bun run test:e2e`      | E2E tests (requires Docker + `docker-rollout`) |
| `bun run validate`      | Full suite: lint + typecheck + unit + E2E      |

### Coverage scope

`bun run test:coverage` reports unit test coverage only. E2E tests run the server as a subprocess — server-side coverage during E2E is not collected. The two test layers serve complementary purposes:

- **Unit tests** — pure logic in isolation (auth middleware, config validation, queue, notifications)
- **E2E tests** — behavioral contracts against a live server with real Docker, Traefik, and `docker-rollout`

### Known gaps

The following scenarios are not covered by the current test suite. They are tracked here rather than as TODO comments in code.

| Area               | Gap                                                                                       | Risk   |
| ------------------ | ----------------------------------------------------------------------------------------- | ------ |
| `steps/rollout.ts` | Multi-service rollouts (2+ steps) — only single-service tested via E2E                    | Medium |
| `config/loader.ts` | File-not-found and invalid YAML error paths — hard to unit test due to module-level cache | Medium |
| `server.ts`        | Graceful SIGTERM: 503 response during shutdown, clean exit — code exists, no test         | Low    |
| `api/jobs.ts`      | SSE stream abort mid-read, empty log file (404)                                           | Low    |
| `api/deploy.ts`    | Empty `image_tag` input (passes `t.String()` validation)                                  | Low    |

---

## Roadmap

### MVP

- [x] Bearer auth (`ADMIN_TOKEN` + `WEBHOOK_TOKEN` env vars, two roles)
- [x] `POST /deploy/:app` — accepts `image_tag`, returns `job_id`
- [x] `GET /jobs/:id` — status + metadata
- [x] `GET /jobs/:id/logs` — SSE stream from `data/logs/<id>.log`
- [x] `GET /jobs` — paginated job history with app/status filters
- [x] Pre-deploy validation (`compose_path` existence check)
- [x] Zero-downtime rolling deployment (scale → health-gate → remove old)
- [x] Pushover + configurable webhook notifications
- [x] `rollhook` npm package (TypeBox schemas + TS types, JSON Schema via jsDelivr CDN)
- [x] `rollhook.config.yaml` loading + validation
- [x] Example app with correct compose, healthcheck, and graceful shutdown
- [x] Public Docker image: `registry.jkrumm.com/rollhook`
- [x] `examples/infra/` — reference `compose.infra.yml` (Traefik + RollHook + socket proxy)

### Post-MVP

- [ ] `PATCH /registry/:app` — persist config changes to `rollhook.config.yaml` (currently in-memory only)
- [ ] Ordered multi-service steps with dependency graph
- [ ] Rollback: `POST /deploy/:app/rollback` (redeploy last successful image)
- [ ] Multi-VPS support via Docker contexts
- [ ] Static site deployment (nginx + Traefik labels)
- [ ] Self-hosting guide + Hetzner quickstart
