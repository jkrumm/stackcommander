# RollHook

**Webhook-triggered zero-downtime rolling deployments for Docker Compose.**

[![Docker](https://img.shields.io/badge/docker-registry.jkrumm.com%2Frollhook-blue)](https://registry.jkrumm.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Receives a deploy webhook from GitHub Actions, pulls the new image, rolls it out one container at a time — each gated on a healthcheck passing — streams logs live to CI. No config files. Stateless auto-discovery from running container labels.

---

## Quick Start

### 1. Run RollHook on your VPS

Copy [`compose.yml`](compose.yml) from this repo to your server and create a `.env` file next to it:

```env
ACME_EMAIL=you@example.com
ROLLHOOK_SECRET=changeme          # openssl rand -hex 32
COMPOSE_DIR=/home/user/myapp      # directory where your compose.yml lives
```

Secrets managers like [Doppler](https://doppler.com) and [Infisical](https://infisical.com) both support Docker Compose natively as `.env` alternatives.

Then start the stack:

```bash
docker compose up -d
```

The included `compose.yml` contains Traefik (with automatic TLS via Let's Encrypt), RollHook, and a placeholder `app` service — replace it with your own.

### 2. Configure your app's compose.yml

Four requirements for zero-downtime:

```yaml
services:
  api:
    image: ${IMAGE_TAG:-registry.example.com/my-api:latest} # 1. IMAGE_TAG var
    healthcheck: # 2. healthcheck required
      test: [CMD, curl, -f, http://localhost:3000/health]
      interval: 5s
      timeout: 5s
      start_period: 10s
      retries: 5
    # 3. No ports: — proxy routes via Docker DNS, ports: blocks scaling
    # 4. No container_name: — fixed names prevent a second instance from starting
    networks:
      - proxy

networks:
  proxy:
    external: true
```

Start the app manually once so RollHook can discover it from the running container's labels:

```bash
docker compose -f /srv/stacks/my-api/compose.yml up -d
```

### 3. Authorize your GitHub repo

Add one label to your app service in compose.yml so RollHook knows which repos may deploy it:

```yaml
labels:
  - rollhook.allowed_repos=myorg/myapp
  # Optional — restrict to specific refs (default: refs/heads/main, refs/heads/master)
  # - rollhook.allowed_refs=refs/heads/main,refs/heads/prod
```

### 4. Trigger deploys from GitHub Actions

No secrets needed. GitHub Actions issues a short-lived cryptographic token per run:

```yaml
permissions:
  id-token: write # required — allows requesting OIDC token

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: jkrumm/rollhook-action@v1
        with:
          url: ${{ vars.ROLLHOOK_URL }}
          image_tag: registry.example.com/my-api:${{ github.sha }}
```

The action requests an OIDC token automatically, POSTs the deploy, streams SSE logs live to CI, and fails the step on deployment failure. See [jkrumm/rollhook-action](https://github.com/jkrumm/rollhook-action) for full docs.

---

## Graceful Shutdown

Your app needs to handle `SIGTERM` cleanly — otherwise the proxy may route requests to a container that has already stopped accepting connections.

Pattern: on `SIGTERM`, return `503` from `/health` (proxy stops routing), wait 2–3 s for deregister, drain in-flight requests, exit.

```ts
// Bun
let isShuttingDown = false

process.on('SIGTERM', async () => {
  isShuttingDown = true
  await new Promise(resolve => setTimeout(resolve, 3000))
  await server.stop(true)
  process.exit(0)
})

// health handler:
if (pathname === '/health')
  return new Response('ok', { status: isShuttingDown ? 503 : 200 })
```

See [`e2e/hello-world/`](e2e/hello-world/) for a complete reference app.

---

## Environment Variables

| Var                        | Required | Description                                        |
| -------------------------- | -------- | -------------------------------------------------- |
| `ROLLHOOK_SECRET`          | yes      | Admin/static bearer token (min 7 chars)            |
| `ROLLHOOK_URL`             | no       | Public server URL — enables OIDC `aud` claim check |
| `DOCKER_HOST`              | no       | Docker daemon endpoint (default: local socket)     |
| `PORT`                     | no       | Listen port (default: `7700`)                      |
| `PUSHOVER_USER_KEY`        | no       | Pushover mobile notifications                      |
| `PUSHOVER_APP_TOKEN`       | no       | Pushover mobile notifications                      |
| `NOTIFICATION_WEBHOOK_URL` | no       | POST full job result JSON on completion            |

---

## API

Interactive docs at `/openapi` on your running instance. Key routes:

| Method | Route             | Auth         | Description                                 |
| ------ | ----------------- | ------------ | ------------------------------------------- |
| `POST` | `/deploy`         | bearer       | Trigger deploy (`?async=true` to not block) |
| `GET`  | `/jobs/{id}`      | bearer       | Job status + metadata                       |
| `GET`  | `/jobs/{id}/logs` | bearer       | SSE log stream                              |
| `GET`  | `/jobs`           | bearer       | History (`?app=&status=&limit=`)            |
| `GET`  | `/health`         | none         | `{ status, version }`                       |
| `GET`  | `/v2/*`           | bearer/basic | OCI registry proxy                          |

**Auth:** `POST /deploy` accepts GitHub Actions OIDC JWTs (no secret needed in CI) or `Bearer <ROLLHOOK_SECRET>`. All other routes require `Bearer <ROLLHOOK_SECRET>`.

---

## Notifications

Set `PUSHOVER_USER_KEY` + `PUSHOVER_APP_TOKEN` for mobile push on deploy completion.
Set `NOTIFICATION_WEBHOOK_URL` to POST the full `JobResult` JSON anywhere.
Notification failures are written to the job log — they never affect job status.
