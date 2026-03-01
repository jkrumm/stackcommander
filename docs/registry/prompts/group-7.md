# Group 7: GitHub Action Rewrite

## What You're Doing

Rewrite `rollhook-action` as a composite action: build → push → explicit deploy. Users need only `url`, `secret`, `app`. Also supports external registries (just deploy, no build/push). Update RollHook's own `release.yml` to use the new action.

**Deploy is always explicit.** The action calls `POST /deploy` after pushing to the registry. No magic. Users who want to decouple push from deploy can call the two operations in separate workflow steps.

---

## Research & Exploration First

Before writing code:

1. Read `~/SourceRoot/rollhook-action/action.yml` — current inputs/outputs
2. Read `~/SourceRoot/rollhook-action/src/index.ts` — current deploy polling + SSE log streaming logic. This logic needs to survive as a shell script (or Node inline script) in the composite action.
3. Read `~/SourceRoot/rollhook/.github/workflows/release.yml` — the ~100 lines you're simplifying. Note every `docker/*` action being called.
4. Read `~/SourceRoot/rollhook/.github/workflows/ci.yml` — understand the parallel CI setup.
5. **Research GitHub composite actions:** WebFetch `https://docs.github.com/en/actions/creating-actions/creating-a-composite-action` — understand how to use `uses:` and `run:` steps inside a composite, how `inputs` are accessed inside shell steps (`${{ inputs.foo }}`), and how `outputs` from inner steps are surfaced.
6. **Research `docker/metadata-action@v5` output format** — understand how to consume `${{ steps.meta.outputs.tags }}` in subsequent steps.
7. **Check current rollhook-action Node.js version** — can you run inline Node.js with `node` in shell steps to reuse the poll/SSE logic? Or implement polling in pure bash (simpler).

---

## What to Implement in `~/SourceRoot/rollhook-action`

### 1. New `action.yml` — composite type

```yaml
name: RollHook Deploy
description: Build and push a Docker image to RollHook registry, then trigger a rolling deploy.

inputs:
  url:
    description: RollHook server URL (e.g. https://rollhook.yourdomain.com)
    required: true
  secret:
    description: ROLLHOOK_SECRET
    required: true
  app:
    description: App name. Used as image name in the registry. Required unless `image` is set.
    required: false
  dockerfile:
    description: Path to Dockerfile
    required: false
    default: Dockerfile
  context:
    description: Docker build context path
    required: false
    default: .
  public:
    description: Make image publicly pullable without auth
    required: false
    default: 'false'
  image:
    description: |
      Full image tag for external registry mode (e.g. ghcr.io/org/app:sha).
      When provided, skips build/push. Uses direct /deploy call with this image_tag.
      Use this for external registries, rollbacks, or when build happens separately.
    required: false
  timeout:
    description: Deploy timeout in seconds
    required: false
    default: '600'

outputs:
  job_id:
    description: RollHook job ID
    value: ${{ steps.deploy.outputs.job_id }}
  status:
    description: Deployment result (success/failed)
    value: ${{ steps.wait.outputs.status }}

runs:
  using: composite
  steps:
    # ── Build + Push (RollHook registry mode) ─────────────
    - if: inputs.app != ''
      uses: docker/setup-buildx-action@v3

    - if: inputs.app != ''
      uses: docker/login-action@v3
      with:
        registry: ${{ inputs.url }}
        username: rollhook
        password: ${{ inputs.secret }}

    - if: inputs.app != ''
      id: meta
      uses: docker/metadata-action@v5
      with:
        images: ${{ inputs.url }}/${{ inputs.app }}
        tags: |
          type=sha,prefix=sha-,format=short
          type=raw,value=latest

    - if: inputs.app != ''
      uses: docker/build-push-action@v6
      with:
        context: ${{ inputs.context }}
        file: ${{ inputs.dockerfile }}
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
        platforms: linux/amd64,linux/arm64
        cache-from: type=gha
        cache-to: type=gha,mode=max

    # ── Deploy trigger ─────────────────────────────────────
    - id: deploy
      shell: bash
      env:
        ROLLHOOK_URL: ${{ inputs.url }}
        ROLLHOOK_SECRET: ${{ inputs.secret }}
        # In RollHook registry mode: use sha tag from metadata step
        # In external registry mode: use the provided image input
        IMAGE_TAG: ${{ inputs.image != '' && inputs.image || format('{0}/{1}@{2}', inputs.url, inputs.app, steps.meta.outputs.digest) }}
      run: |
        # ... POST /deploy, capture job_id ...

    # ── Wait for deploy (poll + log streaming) ─────────────
    - id: wait
      shell: bash
      env:
        ROLLHOOK_URL: ${{ inputs.url }}
        ROLLHOOK_SECRET: ${{ inputs.secret }}
        JOB_ID: ${{ steps.deploy.outputs.job_id }}
        TIMEOUT: ${{ inputs.timeout }}
      run: |
        # Poll GET /jobs/:id every 3s
        # Stream GET /jobs/:id/logs (SSE) — pipe to stdout
        # On success: echo "status=success" >> $GITHUB_OUTPUT
        # On failure: echo "status=failed" >> $GITHUB_OUTPUT; exit 1
```

**Deploy step details:**
- `POST /deploy` body: `{ "image_tag": "<IMAGE_TAG>", "triggered_by": "ci" }`
- Parse `job_id` from response: `echo "job_id=..." >> $GITHUB_OUTPUT`
- Handle non-200 response with clear error message

**Wait step — implement polling + log streaming in bash:**
- Start SSE log stream in background: `curl -N -H "Authorization: Bearer $ROLLHOOK_SECRET" "$ROLLHOOK_URL/jobs/$JOB_ID/logs" &`
- Poll status in foreground every 3s
- On terminal status (success/failed): kill background curl, set outputs, exit
- Respect `TIMEOUT` — fail after N seconds with clear message

### 2. Remove old TypeScript source

Delete `src/`, `dist/`, `package.json`, `tsconfig.json`, `node_modules/`, `.npmrc` if present. Keep only `action.yml`, `README.md`, `LICENSE`.

The composite action needs no compilation step.

### 3. Update `README.md`

**Minimal (RollHook registry):**
```yaml
- uses: jkrumm/rollhook-action@v1
  with:
    url: ${{ secrets.ROLLHOOK_URL }}
    secret: ${{ secrets.ROLLHOOK_SECRET }}
    app: my-app
```

**External registry (deploy only):**
```yaml
# Build + push handled separately (e.g. to ghcr.io)
- uses: jkrumm/rollhook-action@v1
  with:
    url: ${{ secrets.ROLLHOOK_URL }}
    secret: ${{ secrets.ROLLHOOK_SECRET }}
    image: ghcr.io/${{ github.repository }}:${{ github.sha }}
```

**Multi-container:**
```yaml
- uses: jkrumm/rollhook-action@v1
  with:
    url: ${{ secrets.ROLLHOOK_URL }}
    secret: ${{ secrets.ROLLHOOK_SECRET }}
    app: frontend
    dockerfile: apps/frontend/Dockerfile

- uses: jkrumm/rollhook-action@v1
  with:
    url: ${{ secrets.ROLLHOOK_URL }}
    secret: ${{ secrets.ROLLHOOK_SECRET }}
    app: backend
    dockerfile: apps/backend/Dockerfile
```

**Decouple push from deploy (staging/prod promotion):**
```yaml
# Staging: push image (no deploy)
- uses: docker/build-push-action@v6
  with:
    push: true
    tags: rollhook.staging.com/app:${{ github.sha }}

# Production: deploy specific image (after testing/approval)
- uses: jkrumm/rollhook-action@v1
  with:
    url: ${{ secrets.ROLLHOOK_URL }}
    secret: ${{ secrets.ROLLHOOK_SECRET }}
    image: rollhook.staging.com/app:${{ github.sha }}
```

---

## What to Implement in `~/SourceRoot/rollhook`

### 4. Update `.github/workflows/release.yml`

Replace all docker build/push/login steps with:
```yaml
- uses: ./  # dogfood the local action
  with:
    url: ${{ secrets.ROLLHOOK_URL }}
    secret: ${{ secrets.ROLLHOOK_SECRET }}
    app: rollhook
```

Remove these steps entirely: `docker/login-action`, `docker/setup-buildx-action`, `docker/build-push-action`, `docker/metadata-action`.

### 5. Update `CLAUDE.md`

- Update env var table (final state)
- Add architecture note about registry
- Add action usage note

---

## E2E Strategy

**Run final full E2E for this group:**
```bash
bun run test:e2e
```

This is the final checkpoint — everything must be green. If any test has been broken during Groups 1-7 and not yet fixed, fix it now.

---

## Verification

In `rollhook-action`:
- `action.yml` has no syntax errors (validate with `cat action.yml | python3 -c "import sys,yaml; yaml.safe_load(sys.stdin)"`)
- No broken file references

In `rollhook`:
```bash
bun run typecheck && bun run lint && bun run test
bun run test:e2e
```

---

## Commits

In `~/SourceRoot/rollhook-action`:
```bash
git add -A
git commit -m "feat(action): rewrite as composite action wrapping build+push+deploy"
```

In `~/SourceRoot/rollhook`:
```bash
git commit -m "feat(ci): simplify release workflow using new composite rollhook-action"
```

---

## Done

Write learning notes to `docs/registry/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 7
```
