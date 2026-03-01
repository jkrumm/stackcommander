# Group 1: Foundation — Secret Consolidation

## What You're Doing

Replace the two-token auth model (`ADMIN_TOKEN` + `WEBHOOK_TOKEN`) with a single `ROLLHOOK_SECRET` environment variable. Add startup validation to reject weak or missing secrets. Greenfield — no backward compat needed, no migration guards.

---

## Research & Exploration First

Before writing any code:
1. Read `apps/server/src/middleware/auth.ts` — understand current two-token role logic
2. Read `apps/server/server.ts` — understand current env var bootstrapping and startup sequence
3. Read `apps/server/src/__tests__/preload.ts` and `apps/server/src/__tests__/auth.test.ts` — current test patterns
4. Read `e2e/setup/fixtures.ts` and `e2e/compose.e2e.yml` — current E2E token setup
5. Run: `grep -r "ADMIN_TOKEN\|WEBHOOK_TOKEN" . --include="*.ts" --include="*.yml" --include="*.yaml" --include="*.md" --exclude-dir=".git" --exclude-dir="node_modules" -l` — find every file needing changes

---

## What to Implement

### 1. Startup validation

In `apps/server/server.ts` (before `.listen()`):

```typescript
const secret = process.env.ROLLHOOK_SECRET
if (!secret || secret.length < 7) {
  console.error('ROLLHOOK_SECRET must be set and at least 7 characters long.')
  process.exit(1)
}
```

This is the only validation needed. Don't over-engineer it — no complexity checks, no character requirements. Just length >= 7. Clear error, immediate exit.

### 2. Update `apps/server/src/middleware/auth.ts`

Remove the `ADMIN_TOKEN`/`WEBHOOK_TOKEN` split. Both `admin` and `webhook` role checks now validate against `ROLLHOOK_SECRET`.

If the role concepts are used in route definitions elsewhere (to distinguish access levels), you may either:
- Keep the internal role type but make both accept `ROLLHOOK_SECRET` — clean separation if we ever add roles back
- Or simplify to a single `authenticated` check if roles are only used internally in auth.ts

Choose whichever is simpler to implement cleanly. Document the decision in the learning notes.

### 3. Update all references

Find and update every file that references `ADMIN_TOKEN` or `WEBHOOK_TOKEN`:

- `apps/server/src/__tests__/preload.ts` → set `ROLLHOOK_SECRET = 'test-secret-ok'` (>= 7 chars)
- `apps/server/src/__tests__/auth.test.ts` → update all token strings
- `e2e/setup/fixtures.ts` → single token constant
- `e2e/compose.e2e.yml` → `ROLLHOOK_SECRET: ${ROLLHOOK_SECRET}`
- `e2e/setup/global.ts` → update env var name passed to compose
- `examples/**/*.yml` → update env var names
- `CLAUDE.md` → update env var table

### 4. Update packages/rollhook types if needed

Check `packages/rollhook/src/types.ts` for any auth-related types. Update if needed.

---

## E2E Strategy

**Run E2E for this group.** The token rename affects E2E fixtures and compose env vars. After updating all references, run:

```bash
bun run test:e2e
```

All existing E2E tests (auth, deploy, failure, health, jobs, queue, zero-downtime) must pass unchanged. The deploy flow still works the same way — only the env var names changed. If any E2E test fails, fix it before signaling completion.

Note: E2E compose still has `registry:2` service (removed in Group 3). That's fine for now.

---

## Verification

```bash
# Zero results expected (excluding docs/registry/ and .git):
grep -r "ADMIN_TOKEN\|WEBHOOK_TOKEN" . \
  --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.yaml" \
  --exclude-dir=".git" --exclude-dir="node_modules" --exclude-dir="docs"

bun run typecheck && bun run lint && bun run test
bun run test:e2e
```

---

## Commit

```bash
git commit -m "feat(auth): replace dual-token model with single ROLLHOOK_SECRET + startup validation"
```

---

## Done

Write learning notes to `docs/registry/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group 1
```
