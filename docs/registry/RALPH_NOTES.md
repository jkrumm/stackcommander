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

---

## Group 2: Zot Binary & Process Manager

### What was implemented

Bundled Zot v2.1.14 into the Dockerfile (TARGETARCH-aware, SHA256-verified for amd64 + arm64). Created `registry/config.ts` for Zot config generation and htpasswd creation using `Bun.password.hash` (bcrypt, no extra deps). Created `registry/manager.ts` to start Zot as a subprocess bound to `127.0.0.1:5000`, poll until ready (200 or 401), pipe output with `[zot]` prefix, and expose `getInternalCredentials()`. Wired into `server.ts` startup before `app.listen()`.

### Deviations from prompt

- **Top-level await banned**: `@antfu/eslint-config` enforces `antfu/no-top-level-await`. Restructured `server.ts` to use `.then().catch()` chain instead of `await registryManager.start()` at module level.
- **No bcrypt dependency added**: Bun has `Bun.password.hash(password, { algorithm: 'bcrypt' })` built-in. No npm package needed. Used cost factor 12.
- **Type casting for Bun.spawn**: Used `as unknown as ZotProcess` to avoid fighting Bun's complex generic subprocess types. A local `ZotProcess` interface captures the subset of properties we actually use (stdout, stderr, exited, kill).

### Gotchas & surprises

- `perfectionist/sort-named-imports` sorts case-insensitively (lowercase before uppercase), so `{ ZOT_USER, generateHtpasswd }` must be `{ generateHtpasswd, ZOT_USER }`. Auto-fixed by `lint:fix`.
- `style/member-delimiter-style` requires commas in object type annotations: `{ user: string, password: string }` not `{ user: string; password: string }`. Also auto-fixed.
- Zot release SHA256 hashes are in `checksums.sha256.txt` (not per-file `.sha256sum` files). Fetched via GitHub API + redirect.
- Zot binary is ~200 MB. This significantly increases image build time. Acceptable for the embedded registry use case.
- `$2b$` bcrypt prefix from Bun is accepted by Zot's Go bcrypt library (which accepts `$2a$`, `$2b$`, `$2y$`).

### Security notes

- Zot binds exclusively to `127.0.0.1:5000` — never reachable from outside the container. The bcrypt hash in `.htpasswd` is one-way and safe to store in the data volume.
- `ROLLHOOK_SECRET` doubles as the Zot internal password. Since Zot is loopback-only, the main risk is container compromise — at which point all secrets are already exposed. No material increase in attack surface.
- `.htpasswd` is written to `/app/data/registry/` (the bound volume). It should be treated as a secret file — not world-readable. Consider `chmod 600` in a future hardening pass.

### Tests added

`apps/server/src/__tests__/registry-config.test.ts` — 9 tests covering:
- `getZotPassword()` returns `ROLLHOOK_SECRET`
- `generateZotConfig()`: valid JSON, loopback address, port as string, storage root, htpasswd path, distSpecVersion
- `generateHtpasswd()`: ZOT_USER prefix, `$2b$` bcrypt format, hash verifies against secret

### Future improvements

- `chmod 600` on `.htpasswd` and `config.json` after writing them (currently default umask applies).
- Zot crash recovery: currently logs the error but does not restart. A restart policy with exponential backoff would improve resilience.
- The `pipeWithPrefix` function prepends `[zot] ` to each chunk, which may split mid-line on high-throughput output. A line-buffered approach would be cleaner but is not critical for log readability.
- Consider emitting a startup metric or log event when the registry becomes ready (for observability in Group 6+).
