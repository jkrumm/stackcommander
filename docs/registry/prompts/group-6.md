# Group 6: Dashboard Registry UI

## What You're Doing

Add a Registry section to the RollHook dashboard. Users see stored images, version history with OCI metadata, image/tag deletion, a pull command, and a public/private toggle. No Zot branding anywhere.

---

## Research & Exploration First

Before writing code:

1. **Explore the full dashboard** — use the Explore agent to understand the complete `apps/dashboard/` structure:
   - Routing (React Router? TanStack Router? file-based?)
   - Data fetching pattern (React Query? SWR? raw fetch + useState?)
   - Component library in use (`packages/ui/`, shadcn components)
   - How auth token is stored and used in requests
   - Existing page components (job list, job detail) — use them as templates
   - `apps/dashboard/package.json` — what deps are available?
2. Read `apps/server/src/api/registry.ts` (Group 4) — understand all response shapes you'll consume
3. Read `packages/ui/` — understand available components, design tokens, icon set
4. Look at `apps/marketing/src/styles/global.css` — understand basalt-ui CSS setup

**Do not introduce new dependencies** without checking what's already in `apps/dashboard/package.json` first.

---

## What to Implement

### 1. Registry page route

Add `/registry` route. Add "Registry" entry to the nav sidebar/header.

Handle the case where registry API returns 503 gracefully: show "Registry starting..." or "Registry unavailable" — not an error page.

### 2. `RegistryPage` — image list

Fetches `GET /api/registry`.

Shows a card or table row per app:
- App name
- Latest tag (e.g. `sha-abc123`)
- Number of stored versions
- Total size of latest image
- Last pushed timestamp (relative: "2 minutes ago")
- Public/private badge
- Link to app detail

Empty state: "No images stored yet. Push an image to `<ROLLHOOK_URL>/<app>:<tag>` to get started."

### 3. `RegistryAppDetail` — version list

Fetches `GET /api/registry/:app`.

Shows version list sorted newest first:

| Tag | Git SHA | Size | Pushed | |
|-|-|-|-|-|
| sha-abc123 | [abc1234](git-link) | 45 MB | 3 min ago | Delete |
| sha-def456 | def4567 | 44 MB | 2 days ago | Delete |

- Git SHA links to the commit in the source repo (from `org.opencontainers.image.source` + revision OCI labels, if present)
- Delete button calls `DELETE /api/registry/:app/tags/:tag` with confirmation dialog
- "Delete all versions" button at top calls `DELETE /api/registry/:app` with confirmation

### 4. Pull command display

Show for authenticated users:
```
docker pull rollhook.domain.com/my-app:sha-abc123
```
With a copy-to-clipboard button. The host comes from `ROLLHOOK_URL` (surfaced via a config endpoint or embedded in the registry API response).

### 5. Public/private toggle

Toggle switch in the app detail header. Calls `PATCH /api/registry/:app`.
- Private (default): label "Private — auth required to pull"
- Public: label "Public — anyone can pull"

Optimistic update, revert on error, show toast.

### 6. Cross-link from job history

In the existing jobs list/detail: if `triggered_by === 'ci'`, show the image tag used. If the image is in RollHook's registry, make it a link to `RegistryAppDetail`.

---

## UI Standards

- Dark mode (`class="dark"` on `<html>`)
- Follow existing dashboard component patterns exactly — same spacing, same component usage, same data-fetching pattern
- Use `lucide-react` for icons
- Use `clsx`/`cn()` for conditional classes
- Relative timestamps using whatever utility is already in the dashboard

---

## E2E Strategy

**No E2E for this group** — visual components are not easily automated with the current test setup. Validate manually:
```bash
# Start dev server
bun run dev  # or check package.json for the correct script
```

Then navigate to `localhost:7700` (or dashboard port) and verify the registry UI works.

**Unit tests** (if the dashboard has a component test setup): add tests for:
- `RegistryPage` renders empty state
- `RegistryAppDetail` renders tag list

If there's no component test setup, skip unit tests and rely on TypeScript + visual validation.

---

## Verification

```bash
bun run typecheck && bun run lint
```

TypeScript must be clean. Lint must pass.

---

## Commit

```bash
git commit -m "feat(dashboard): add registry UI with image list, version history, and image deletion"
```

---

## Done

Write learning notes to `docs/registry/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 6
```
