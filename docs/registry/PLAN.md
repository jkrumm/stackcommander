# RollHook Registry — Architecture & Implementation Plan

## Goal

Embed an OCI-compliant image registry (Zot) into RollHook so users need **zero external services** — just a VPS, a Docker socket, and one secret.

User-facing surface after this feature:

```yaml
# docker-compose.yml
services:
  rollhook:
    image: registry.jkrumm.com/rollhook:latest
    environment:
      ROLLHOOK_SECRET: <your-secret>           # min 7 chars
      ROLLHOOK_URL: https://rollhook.yourdomain.com  # optional, for canonical image tags
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - rollhook_data:/app/data                # everything persists here
```

```yaml
# .github/workflows/release.yml
- uses: jkrumm/rollhook-action@v1
  with:
    url: ${{ secrets.ROLLHOOK_URL }}
    secret: ${{ secrets.ROLLHOOK_SECRET }}
    app: my-app
```

That is the entire setup. One secret. One action step. One volume for backups.

---

## Architecture

```
GitHub Actions
  └── rollhook-action@v1
        ├── docker login    rollhook.domain.com  (Bearer ROLLHOOK_SECRET)
        ├── docker build+push  rollhook.domain.com/my-app:sha-<short>
        └── POST /deploy    { image_tag: "rollhook.domain.com/my-app:sha-<short>", triggered_by: "ci" }
                             ↓ explicit deploy trigger — always intentional

Internet → Traefik (TLS) → RollHook container :7700
                                ├── GET  /health
                                ├── POST /deploy               (ROLLHOOK_SECRET)
                                ├── GET  /jobs/:id             (ROLLHOOK_SECRET)
                                ├── GET  /jobs/:id/logs        (SSE, ROLLHOOK_SECRET)
                                ├── GET  /api/registry         (ROLLHOOK_SECRET)
                                ├── GET  /api/registry/:app    (ROLLHOOK_SECRET)
                                ├── PATCH /api/registry/:app   (ROLLHOOK_SECRET)
                                ├── DELETE /api/registry/:app  (ROLLHOOK_SECRET)
                                ├── DELETE /api/registry/:app/tags/:tag
                                └── /v2/*  ────────────────────────────────────────┐
                                                                                   │
                                           OCI proxy (Elysia):                     │
                                           • validate Bearer/Basic ROLLHOOK_SECRET │
                                           • public repos: skip auth on GET/HEAD   │
                                           • forward with internal Zot credentials  │
                                                                                   ▼
                                                          Zot :5000 (127.0.0.1 — never exposed)
                                                          • blobs + manifests in /app/data/registry/
                                                          • config auto-generated at startup
                                                          • always running — not configurable
```

### Key Design Decisions

- **Registry is always on.** No `ENABLE_REGISTRY` flag. Simplicity wins.
- **No auto-deploy on push.** Deploy is always an explicit `POST /deploy`. Users who want it automatic just call both in sequence in CI. Users who want to decouple push from deploy (staging/prod, rollback, approval gate) have full control.
- **Single `ROLLHOOK_SECRET`.** Auth for registry, deploy webhook, and dashboard. Min 7 chars validated at startup.
- **External registry path preserved.** Pass any `image_tag` to `/deploy` — RollHook will `docker pull` from ghcr.io, Docker Hub, or any authenticated registry. Mixed usage (some apps on RollHook registry, some external) is fully supported.
- **One volume = one backup.** All data in `/app/data/`: SQLite, registry blobs, Zot config. `rsync /app/data/ backup/` is a complete backup.
- **Zot completely hidden.** No port exposed, no config for users, no Zot UI. Dashboard shows images/versions through RollHook's own API.

---

## Components

| Component | Files | Group |
|-|-|-|
| Secret consolidation + startup validation | `middleware/auth.ts`, `server.ts`, tests, E2E | 1 |
| Zot binary in Docker image | `Dockerfile` | 2 |
| Zot process manager | `src/registry/manager.ts`, `config.ts` | 2 |
| OCI proxy routes | `src/registry/proxy.ts`, `src/app.ts` | 3 |
| E2E migration (registry:2 → embedded) | `e2e/compose.e2e.yml`, `e2e/setup/*` | 3 |
| Registry DB | `src/db/registry.ts`, migration in `db/client.ts` | 4 |
| Zot internal API client | `src/registry/client.ts` | 4 |
| Registry API routes + image deletion | `src/api/registry.ts` | 4 |
| `triggered_by` field, `ROLLHOOK_URL` env | `db/jobs.ts`, `api/deploy.ts`, `types.ts` | 5 |
| Integration E2E (push→deploy) | `e2e/tests/registry-deploy.test.ts` | 5 |
| Dashboard registry UI | `apps/dashboard/src/registry/*` | 6 |
| GitHub Action rewrite | `~/SourceRoot/rollhook-action/*` | 7 |
| `release.yml` simplification | `.github/workflows/release.yml` | 7 |

---

## Task Groups

| # | Title | E2E | Key Deliverable |
|-|-|-|-|
| 1 | Foundation — Secret Consolidation | ✓ run | Single `ROLLHOOK_SECRET`, min-length validation |
| 2 | Zot Binary & Process Manager | – skip | Zot starts automatically in container |
| 3 | OCI Reverse Proxy | ⚠ migrate | `docker push/pull` through RollHook; `registry:2` gone |
| 4 | Registry API & Visibility | ✓ run | Image list, deletion, public/private |
| 5 | Registry Completeness | ✓ full green | `triggered_by`, integration tests, hardening |
| 6 | Dashboard Registry UI | – visual only | Images/versions in dashboard |
| 7 | GitHub Action Rewrite | ✓ final | One-step action; `release.yml` ≤ 20 lines |

---

## Running the RALPH Loop

```bash
# Prerequisites (once)
brew install coreutils   # gtimeout

# Run all pending groups
./scripts/ralph.sh

# Check current status
./scripts/ralph.sh --status

# Run a specific group
./scripts/ralph.sh 3

# Reset a group and retry
./scripts/ralph-reset.sh 3 && ./scripts/ralph.sh 3
```

State files (gitignored): `.ralph-tasks.json`, `.ralph-logs/group-N.log`
Report: `docs/registry/RALPH_REPORT.md`
Learning notes: `docs/registry/RALPH_NOTES.md` (written by Claude after each group)

---

## Data Volume Layout

```
/app/data/                  ← bind mount this for backups
  rollhook.db               ← SQLite: jobs + registry_repos
  registry/
    config.json             ← Zot config (auto-generated at startup)
    .htpasswd               ← Zot auth (auto-generated, internal only)
    blobs/                  ← OCI layer storage (managed by Zot)
    index/                  ← OCI index storage (managed by Zot)
```

Backup command: `rsync -av /app/data/ /backup/rollhook/`

---

## End State: Success Criteria

- [ ] `docker login <rollhook-url>` works with `ROLLHOOK_SECRET`
- [ ] `docker push <rollhook-url>/myapp:sha` stores image, returns 201
- [ ] `POST /deploy` with RollHook-hosted image triggers rolling deploy
- [ ] `POST /deploy` with external image (ghcr.io etc.) still works
- [ ] `docker pull <rollhook-url>/myapp:sha` works (auth required for private)
- [ ] `docker pull <rollhook-url>/publicapp:sha` works without auth (public flag)
- [ ] `DELETE /api/registry/:app/tags/:tag` removes tag from Zot
- [ ] Dashboard shows images, versions, OCI labels, deletion buttons
- [ ] `bun run test` passes (unit tests)
- [ ] `bun run test:e2e` passes (no `registry:2` anywhere)
- [ ] `bun run typecheck && bun run lint` clean
- [ ] `rollhook-action@v1`: `url` + `secret` + `app` = complete CI setup
- [ ] `release.yml` has ≤ 20 lines for the deploy job

---

## What This Is NOT

- Not a multi-tenant registry
- Not Harbor/Nexus (no scanning, replication, LDAP)
- Not a permanent image archive (no GC, no retention policies — future work)
- Not magic: deploy is always explicit, push does not auto-deploy
