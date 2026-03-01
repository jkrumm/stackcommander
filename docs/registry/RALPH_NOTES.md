# RALPH Implementation Notes

---

## Group 1: Foundation — Secret Consolidation

### What was implemented

Replaced the two-token auth model (`ADMIN_TOKEN` + `WEBHOOK_TOKEN`) with a single `ROLLHOOK_SECRET` environment variable. Added startup validation (min 7 characters). Updated all references across docs, examples, and CI workflow.

### Deviations from prompt

The core code files (`auth.ts`, `server.ts`, `preload.ts`, `auth.test.ts`, `fixtures.ts`, `compose.e2e.yml`, `global.ts`, and the example YAML files) were already migrated when the group was picked up — previous incremental work had partially applied this group. Only `README.md`, `CLAUDE.md`, and `.github/workflows/release.yml` still required updates.

### Gotchas & surprises

- `docs/registry/*.md` files (PLAN.md, tasks.md, prompt files) have 131 pre-existing lint errors (format/prettier issues in code fences). These are not in any changed files and were not introduced here — reported but not fixed per convention.
- The GitHub Actions secret was named `ROLLHOOK_WEBHOOK_TOKEN` in the release workflow — renamed to `ROLLHOOK_SECRET` in the workflow file. The actual GitHub secret in the repo settings needs to be renamed separately (or a new secret added before the old one is removed).

### Security notes

- Single-token model is simpler but reduces granularity: CI scripts now have full API access (not just deploy + poll). This is an acceptable trade-off for a self-hosted personal tool; the threat model is primarily external attackers, not compromised CI tokens.
- `ROLLHOOK_SECRET` min-7 validation at startup prevents accidental weak secrets. `openssl rand -hex 32` is the recommended generation method (64 chars).

### Tests added

No new tests added — all existing unit tests (75/75) pass unchanged. Auth behavior is fully covered by `auth.test.ts` which already validates the single-token model.

### Future improvements

- Could add a minimum entropy check (not just length) for stronger secret validation.
- GitHub secret rename (`ROLLHOOK_WEBHOOK_TOKEN` → `ROLLHOOK_SECRET`) must be done manually in the repo settings — not automated.
- The `webhookPollJobUntilDone` helper in `fixtures.ts` is now redundant (identical to `pollJobUntilDone`) since there's no token distinction — could be removed in a cleanup pass.
