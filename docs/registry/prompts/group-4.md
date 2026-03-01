# Group 4: Registry API & Visibility

## What You're Doing

Add API routes that expose registry metadata (images, tags, manifests) for the dashboard. Add a `registry_repos` SQLite table for per-app visibility (public/private). Add image and tag deletion. Implement public image pull: unauthenticated GET requests pass through for repos marked public.

---

## Research & Exploration First

Before writing code:

1. Read `apps/server/src/db/client.ts` — understand the migration pattern (`applyMigrations` with `PRAGMA table_info` idempotency)
2. Read `apps/server/src/db/jobs.ts` — understand CRUD patterns and TypeScript types used
3. Read `apps/server/src/api/jobs.ts` — understand Elysia route patterns with auth and query params
4. Read `apps/server/src/registry/proxy.ts` (from Group 3) — you'll update auth logic here for public repos
5. Read `apps/server/src/app.ts` — understand route registration
6. **Research Zot's API for listing images/tags:** Use WebFetch on Zot's API guide to understand how to list repos, tags, and get manifest details from the `/v2/` endpoints. The OCI spec defines these:
   - `GET /v2/_catalog` — list repos
   - `GET /v2/<name>/tags/list` — list tags
   - `GET /v2/<name>/manifests/<ref>` — get manifest (includes layer digests)
   - `GET /v2/<name>/blobs/<digest>` — get config blob (contains OCI image labels)
7. Understand OCI manifest structure: how to parse total image size from layer sizes, how to find OCI annotations (git SHA in `org.opencontainers.image.revision`, source URL in `org.opencontainers.image.source`, creation time in `org.opencontainers.image.created`).

---

## What to Implement

### 1. SQLite schema (breaking change — greenfield, no migration guards needed)

In `apps/server/src/db/client.ts`, add to `applyMigrations`:

```sql
CREATE TABLE IF NOT EXISTS registry_repos (
  name TEXT PRIMARY KEY,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

No migration guard (no `PRAGMA table_info` check needed since this is greenfield). Just `CREATE TABLE IF NOT EXISTS`.

### 2. Create `apps/server/src/db/registry.ts`

```typescript
export function upsertRepo(db: Database, name: string): void
export function setRepoVisibility(db: Database, name: string, isPublic: boolean): void
export function getRepo(db: Database, name: string): { name: string; is_public: boolean; created_at: string } | null
export function listRepos(db: Database): Array<{ name: string; is_public: boolean; created_at: string }>
export function deleteRepo(db: Database, name: string): void
```

### 3. Create `apps/server/src/registry/client.ts`

Internal Zot client (uses `manager.getInternalCredentials()`):

```typescript
export interface TagInfo {
  tag: string
  digest: string
  size: number        // total compressed size in bytes (sum of layer sizes)
  created?: string    // from OCI config label org.opencontainers.image.created
  gitSha?: string     // from org.opencontainers.image.revision
  gitSource?: string  // from org.opencontainers.image.source
}

export interface ZotClient {
  listRepos(): Promise<string[]>
  listTags(app: string): Promise<string[]>
  getTagInfo(app: string, tag: string): Promise<TagInfo>
  deleteTag(app: string, tag: string): Promise<void>
  deleteRepo(app: string): Promise<void>  // deletes all tags then the repo
}
```

For `deleteTag`: OCI spec requires `DELETE /v2/<name>/manifests/<digest>` (by digest, not by tag name). First resolve the tag to its digest with a HEAD request.

For `deleteRepo`: list all tags, delete each, then the repo entry is gone from Zot's catalog naturally.

For `getTagInfo`: parse manifest layers for total size. Fetch the config blob to read OCI annotations.

### 4. Create `apps/server/src/api/registry.ts`

```typescript
// GET /api/registry
// → [{ name, is_public, tag_count, total_size_latest, last_pushed, latest_tag }]
// Auth: ROLLHOOK_SECRET

// GET /api/registry/:app
// → { name, is_public, tags: TagInfo[] } sorted newest first
// Auth: ROLLHOOK_SECRET

// PATCH /api/registry/:app
// Body: { public: boolean }
// Auth: ROLLHOOK_SECRET

// DELETE /api/registry/:app
// Deletes all tags from Zot + removes from registry_repos
// Auth: ROLLHOOK_SECRET

// DELETE /api/registry/:app/tags/:tag
// Deletes single tag from Zot
// Auth: ROLLHOOK_SECRET
```

Return `503` from all registry routes when Zot manager is not running (shouldn't happen, but defensive).

### 5. Update `apps/server/src/registry/proxy.ts` — public repo bypass

For GET and HEAD on `/v2/<app>/manifests/*` and `/v2/<app>/blobs/*`:
- Parse `app` from the path
- Check `getRepo(db, app)?.is_public`
- If public: forward to Zot without auth validation

Update `createRegistryProxy(manager, db)` signature to accept the db instance.

### 6. Register in `apps/server/src/app.ts`

```typescript
import { createRegistryApi } from '@/api/registry'
app.use(createRegistryApi(zotClient, db))
```

### 7. Unit tests: `apps/server/src/__tests__/registry-api.test.ts`

- `upsertRepo` is idempotent
- `setRepoVisibility` updates flag
- `deleteRepo` removes row
- `GET /api/registry` → 401 without auth
- `GET /api/registry` → 200 with auth (may return empty array if Zot not running in test)
- `PATCH /api/registry/:app` → toggles is_public
- `DELETE /api/registry/:app` → 204

---

## E2E Strategy

**Add registry E2E tests for this group.** Create `e2e/tests/registry.test.ts`:

```typescript
describe('registry API', () => {
  // After E2E setup pushes hello-world images, these should return data:
  it('GET /api/registry lists pushed images')
  it('GET /api/registry/:app lists tags with OCI metadata')
  it('public image can be pulled without auth')
  it('private image returns 401 without auth')
  it('DELETE /api/registry/:app/tags/:tag removes tag')
  it('DELETE /api/registry/:app removes all tags and app')
})
```

Run:
```bash
bun run test:e2e
```

All previous tests + new registry tests must pass.

---

## Data Volume Note

All data generated by this group lives in `/app/data/`:
- `rollhook.db` contains `registry_repos` table
- Registry blobs/manifests managed by Zot under `/app/data/registry/`

Single volume backup = complete state.

---

## Verification

```bash
bun run typecheck && bun run lint && bun run test
bun run test:e2e
```

---

## Commit

```bash
git commit -m "feat(registry): add registry API routes, visibility control, and image deletion"
```

---

## Done

Write learning notes to `docs/registry/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 4
```
