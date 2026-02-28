## [1.4.2](https://github.com/jkrumm/rollhook/compare/v1.4.1...v1.4.2) (2026-02-28)


### Bug Fixes

* **ci:** pass admin_token to rollhook-action for job polling ([9676173](https://github.com/jkrumm/rollhook/commit/96761734e2464d8505e8ec5fb2e80e943d2da63b))

## [1.4.1](https://github.com/jkrumm/rollhook/compare/v1.4.0...v1.4.1) (2026-02-28)


### Bug Fixes

* **ci:** show response body on failed deploy webhook curl ([569f3cc](https://github.com/jkrumm/rollhook/commit/569f3cc2b09dea7e9827fd5f87180d4e21c58bdf))
* **infra:** add NETWORKS=1 and registry credential mount to socket proxy reference ([386cddd](https://github.com/jkrumm/rollhook/commit/386cddd5340a470813df7912ce28fce5a9697507))

# [1.4.0](https://github.com/jkrumm/rollhook/compare/v1.3.0...v1.4.0) (2026-02-27)


### Features

* **ci:** deploy marketing site to VPS via RollHook after release ([900c0f2](https://github.com/jkrumm/rollhook/commit/900c0f2d529d70f28ae03a2f6ca42d133dd4a5cc))
* **e2e:** comprehensive test suite with server stability fixes ([5c2e6e1](https://github.com/jkrumm/rollhook/commit/5c2e6e1ee494b31b4387ca69a488f4918000c140))
* **marketing:** implement comprehensive SEO improvements ([505dd7d](https://github.com/jkrumm/rollhook/commit/505dd7d816a1c1e83bdd69785488fda1c6f34f05)), closes [#1e1f25](https://github.com/jkrumm/rollhook/issues/1e1f25)


### Performance Improvements

* **marketing:** compress og.png 1.5MB → 504KB via pngquant ([5eedec9](https://github.com/jkrumm/rollhook/commit/5eedec9a87a7b55e0311a52b183eeebb4ab1905e))

# [1.3.0](https://github.com/jkrumm/rollhook/compare/v1.2.0...v1.3.0) (2026-02-27)


### Bug Fixes

* **e2e:** use async deploy in zero-downtime test ([67dba14](https://github.com/jkrumm/rollhook/commit/67dba142bc6e11be1b446eb338970dcc5882f19d))
* **examples:** replace direct docker.sock mount with read-only socket proxy for Traefik ([ff90437](https://github.com/jkrumm/rollhook/commit/ff904374cfdc7b786735ea498a5385ea738b65b6))
* **executor:** avoid Bun spawn ENOENT by mutating process.env for IMAGE_TAG ([1e39597](https://github.com/jkrumm/rollhook/commit/1e39597731b86d91d8da63e2dffd3abe597b31e9))
* **executor:** warm up posix_spawn to prevent ENOENT on first docker rollout ([70415d3](https://github.com/jkrumm/rollhook/commit/70415d3ddeb0e79b19b3995e56b7b87ab41f197f))
* import order and HTML tag in test/marketing files ([9a0878d](https://github.com/jkrumm/rollhook/commit/9a0878d86041bec81323aa815b96f2b44d55f5a4))
* **lint:** pin @antfu/eslint-config and treat bun:* as builtins ([efdd18c](https://github.com/jkrumm/rollhook/commit/efdd18c0b3ce199979ce439f993be088c5f4c222))


### Features

* bundle docker-compose, expose version in /health endpoint ([d50ed7d](https://github.com/jkrumm/rollhook/commit/d50ed7d1e00893f67a6da535ba20c02fcb963aca))

# [1.2.0](https://github.com/jkrumm/rollhook/compare/v1.1.1...v1.2.0) (2026-02-26)


### Bug Fixes

* **ci:** add explicit OCI url label to Docker images ([dfe0ef1](https://github.com/jkrumm/rollhook/commit/dfe0ef13a47085cf75fe638e026c206a8c605854))


### Features

* **deploy:** make deployment endpoint synchronous by default ([d65ee09](https://github.com/jkrumm/rollhook/commit/d65ee090520faa1ae9076921b11f47233062d501))
* **jobs:** add timestamps to logs and queued deployment entry ([7b0fefa](https://github.com/jkrumm/rollhook/commit/7b0fefae3ad1e2a5b9c390211a2ac7581cfbd9ab))
* **marketing:** sharpen brand voice and redesign homepage ([80ef7f3](https://github.com/jkrumm/rollhook/commit/80ef7f3a1e157ed234d3f0d58bb97bba156e1a47))

## [1.1.1](https://github.com/jkrumm/rollhook/compare/v1.1.0...v1.1.1) (2026-02-26)


### Bug Fixes

* **docker:** run bun install in runner stage to fix broken symlinks ([37efe65](https://github.com/jkrumm/rollhook/commit/37efe65e7ec1f09d510fcc7c56e304b23911a76f))

# [1.1.0](https://github.com/jkrumm/rollhook/compare/v1.0.8...v1.1.0) (2026-02-26)


### Features

* **registry:** persist config changes to rollhook.config.yaml ([d76ce71](https://github.com/jkrumm/rollhook/commit/d76ce71fedf21a603bed6fbbc1cbf0be0a365d65))

## [1.0.8](https://github.com/jkrumm/rollhook/compare/v1.0.7...v1.0.8) (2026-02-25)


### Bug Fixes

* **ci:** drop --new-bundle-format flag, keep --tlog-upload=false for cosign v3 ([6173089](https://github.com/jkrumm/rollhook/commit/617308957b807a8547472acaa688103e4e10b21b))

## [1.0.7](https://github.com/jkrumm/rollhook/compare/v1.0.6...v1.0.7) (2026-02-25)


### Bug Fixes

* **ci:** add --tlog-upload=false for cosign v3 Zot-compatible signing ([f33fd0a](https://github.com/jkrumm/rollhook/commit/f33fd0a180b11900da4f247e24d2f21b7a9bdd99))

## [1.0.6](https://github.com/jkrumm/rollhook/compare/v1.0.5...v1.0.6) (2026-02-25)


### Bug Fixes

* **ci:** use old cosign bundle format for Zot compatibility ([ab80efb](https://github.com/jkrumm/rollhook/commit/ab80efbf27e5cb8d4af3573c7c4a08a49ef4d332))

## [1.0.5](https://github.com/jkrumm/rollhook/compare/v1.0.4...v1.0.5) (2026-02-25)


### Bug Fixes

* **ci:** pin cosign-installer to v4.0.0 SHA ([0c42614](https://github.com/jkrumm/rollhook/commit/0c4261470a612f362dd3b22a550370e43ff80a7b))

## [1.0.4](https://github.com/jkrumm/rollhook/compare/v1.0.3...v1.0.4) (2026-02-25)


### Bug Fixes

* **docker:** skip lifecycle scripts during bun install ([1b81b35](https://github.com/jkrumm/rollhook/commit/1b81b351fc975a903f263d40de05a3bd71bf9802))

## [1.0.3](https://github.com/jkrumm/rollhook/compare/v1.0.2...v1.0.3) (2026-02-25)


### Bug Fixes

* **rollout:** resolve docker binary path at module load via Bun.which ([0a79143](https://github.com/jkrumm/rollhook/commit/0a79143a480b62d64d669c7097defaf2199c83d9))

## [1.0.2](https://github.com/jkrumm/rollhook/compare/v1.0.1...v1.0.2) (2026-02-25)


### Bug Fixes

* **docker:** exclude e2e dir but keep e2e/package.json for bun workspace ([baa4b4a](https://github.com/jkrumm/rollhook/commit/baa4b4a249a2dc53fc077312933c2da750f701ee))

## [1.0.1](https://github.com/jkrumm/rollhook/compare/v1.0.0...v1.0.1) (2026-02-25)


### Bug Fixes

* **docker:** copy all workspace package.json files to satisfy bun workspace resolution ([7435509](https://github.com/jkrumm/rollhook/commit/7435509a14d55d456632cf31554f3e25f415d988))

# 1.0.0 (2026-02-25)


### Bug Fixes

* **ci:** disable commitlint body-max-line-length for semantic-release compatibility ([46130a6](https://github.com/jkrumm/rollhook/commit/46130a6be15c40196d950262883f6719eac53a62))
* **ci:** pin vite@6 in web app to fix typecheck, add E2E log artifact on failure ([2096722](https://github.com/jkrumm/rollhook/commit/20967224996999187874fb07511c6b207a80b97b))
* **ci:** track bun.lock + fix docker-rollout download URL ([595d208](https://github.com/jkrumm/rollhook/commit/595d20851a41c08f237d2cee90c9562f82337664))
* **e2e:** fix three root causes blocking test suite ([06014f6](https://github.com/jkrumm/rollhook/commit/06014f661b55fb40a3b0e52eb3410ff19b01b813))
* **executor:** ensure loadConfig errors mark jobs as failed ([f5db01a](https://github.com/jkrumm/rollhook/commit/f5db01a99012e597c47efd478509f094c5c2516b))
* **release:** use Node LTS + npm for semantic-release (requires Node 22.14+) ([6a9d5f3](https://github.com/jkrumm/rollhook/commit/6a9d5f3ca0feb3a9c1e06994be5e665812d31a1f))
* resolve Vite HMR port conflict in web app ([9c0998a](https://github.com/jkrumm/rollhook/commit/9c0998a89d90be98f98446b7fc113129d256d1ab))
* **test:** reduce container proliferation and fix E2E test failures ([c96278b](https://github.com/jkrumm/rollhook/commit/c96278b6f159354fa6be239be1ee25ab9fc7fe4b))


### Features

* **api:** set up Eden Treaty isomorphic client with file-based store ([ee661e6](https://github.com/jkrumm/rollhook/commit/ee661e6b0b0e7974b8fd8ebd7d1d7321b3ba2e66))
* **apps/web:** scaffold Astro marketing site with basalt-ui ([1daac56](https://github.com/jkrumm/rollhook/commit/1daac56f88be228891192155367e9c50ed077aaa))
* **config:** move Pushover credentials to environment variables ([5517a1f](https://github.com/jkrumm/rollhook/commit/5517a1fbd8646ad84658eb627322e59dfcd8a6cd))
* implement single-server architecture on port 7700 ([d54292c](https://github.com/jkrumm/rollhook/commit/d54292cbcabe2bc4b8445900fd77751686b1d855))
* pivot to webhook-driven deployment orchestrator ([25f5bb2](https://github.com/jkrumm/rollhook/commit/25f5bb27697102339ce32beaa5cadf30d1701c46))
* **rollhook:** implement core deployment orchestrator with path aliases ([71ff781](https://github.com/jkrumm/rollhook/commit/71ff7810ced846f0d3febb7ed319f02e475597f9))
* **web:** add Astro marketing site with basalt-ui ([8224303](https://github.com/jkrumm/rollhook/commit/8224303abb390e980ac1c3042f1a92881f4fd8dd))
