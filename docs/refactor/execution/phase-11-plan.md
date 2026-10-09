# Phase 11 plan — Host rehome and deployment continuity

Status: FROZEN at 2026-10-09 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/11-host-rehome.md` (sha256 `31fb70214fd26b21ea570ac79b5a14e38cda21ef479d95c3cb645b16c5f313c9`)
Phase base: `a08832a3efcaa949deefc7c713f8787e67d09179`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| Constitution §4 freezes the target tree: `apps/web` (Rails host), `apps/desktop` (Tauri host); `crates/local-store` stays root; root keeps `package.json`, `package-lock.json`, `Cargo.toml`, `bin/`, `docs/`, `tests/`, `tooling/`, `ops/` | `docs/refactor/CONSTITUTION.md` §4 target tree + ownership list |
| Root Cargo workspace members are `crates/local-store` + `desktop/src-tauri` | `Cargo.toml:2` |
| Root `package.json` owns Rails JS + `packages/*` workspaces; scripts reference `script/` and `test/javascript/`; `imports` map `#elef/*` to `./app/javascript/` | `package.json:8-16` |
| `desktop/crates/` is empty (only `.`/`..`) | `ls -la desktop/crates/` |
| Rails serves repo-root `packages/` via asset path | `config/initializers/assets.rb`: `Rails.root.join("packages")` (must become repo-root-relative after rehome) |
| Tailwind scans packages via root-relative `@source` | `app/assets/tailwind/application.css:7`: `@source "../../../packages/client/src"` (depth changes) |
| Importmap pins are app-relative (no root refs) | `config/importmap.rb` (`pin_all_from "app/javascript/controllers"`, `to:` logical paths) |
| Dockerfile builds from root context (`COPY . .`, `COPY Gemfile...`), `CMD ["bin/rails", ...]` | `Dockerfile:16-40` |
| Compose files use `context: .` + root `dockerfile:` + root `--env-file` | `compose.personal.yml:20-22`, `compose.development.yml:22-24`, CI smoke jobs |
| `scripts/`: release pair (`verify`/`publish-deployment-ref`, GH-gated) + instance pair (`development-instance`, `personal-instance`, compose wrappers) + `check_pr_description.rb` (PR hygiene) + retired `elef-agent` (use banned by AGENTS.md) | `ls scripts/` + file heads |
| Runbook invokes `dev/.env.development.example` + `dev/scripts/development-instance`; watcher itself is host-side, absent from checkout | `docs/mac-mini-deployment.md:108,127,134`; baseline `hosts_and_deployment.machine_ops_in_checkout: false` |
| CI groups: 14 jobs in `ci.yml` (desktop-fast, scan_ruby, scan_js, test, sqlite-test, system-test, desktop, affected, desktop-macos, renderer-macos, production-smoke, development-smoke, record-ci-attestation, publish-deployment-ref) + release (macos, linux, publish) + hygiene (description) | workflow job lists |
| CI consumes root paths: `ruby-version: .ruby-version` (4×), `bin/bundler-audit`, `bin/importmap audit`, `bin/rails ...`, `app/assets/builds/tailwind.css`, `desktop/frontend/package-lock.json`, compose/env-file paths, `scripts/check_pr_description.rb`, release `desktop/` build paths | `ci.yml`, `desktop-release.yml`, `pr-hygiene.yml` |
| Deploy refs advance only on push to dev/main after CI (never from the campaign branch) | `ci.yml` `publish-deployment-ref` job (`if: push && ref dev/main`) + `scripts/publish-deployment-ref` branch gate |
| Docker is available in this container (daemon + compose v2.29.7 installed and verified this phase) | `docker info` → ok; `docker compose version` → v2.29.7; `postgres:17` pulled |
| `bin/check` centralizes desktop paths behind constants (`DESKTOP_SOURCE`, `ROOT`-relative); ownership/boundary/arch scripts hardcode `desktop/`, `app/javascript`, `test/e2e` strings | `bin/check:17,24`; grep counts (ownership 22, boundaries 1, arch 3) |
| Rails binstubs (`rails`, `rake`, `setup`, `ci`, `dev`, `bundler-audit`, `importmap`) are app-coupled (`require_relative ../config/boot`, `Procfile.dev`); only `bin/check` is repo-level | `bin/` heads |
| `.gitignore` root anchors reference both hosts (`/desktop/...` ×5 incl. src-tauri gen, `/app/assets/builds`, `/log`, `/tmp`, `/storage`, `/public/assets`, `/config/*.key`, `/.bundle`, `/.env*`) | `.gitignore` |
| `Procfile.dev` is referenced by nothing automated (manual foreman/overmind use) | grep over compose/Dockerfile/CI → no hits |
| No rust-toolchain file; `.ruby-version` is the single Ruby pin | `ls` + CI `ruby-version:` refs |
| `lib/` holds only `tasks/elef_work.rake` (Rails rake tasks) | `ls lib/tasks` |
| Five human gates are named in §8; H4 = owner-verified live Mac mini web deployment after host rehome; `pending_human_gates` is currently `[]` | constitution §8:349-355; status.json |

Open questions / unknowns (each is a blocker or has a resolution step):
- None. Watcher internals are host-side and unknowable from the checkout; the plan treats the live cutover as H4 (per P11-06) instead of guessing compat shims (see §6).

## 2. Scope
In scope (move manifest; every entry is `git mv`, history-preserving):

Rails → `apps/web/`: `app/`, `config/`, `db/`, `lib/`, `public/`, `vendor/`,
`Rakefile`, `config.ru`, `Gemfile`, `Gemfile.lock`, `.ruby-version`, `script/`,
`test/` (Rails tests + Rails-owned shared e2e scenarios), `Procfile.dev`,
`Dockerfile`, `Dockerfile.development`, `bin/{rails,rake,setup,ci,dev,bundler-audit,importmap}`,
tracked keeps under `storage/`, `log/`, `tmp/`.

Desktop → `apps/desktop/`: `desktop/{README.md,frontend,e2e,scripts,src-tauri}`
(`desktop/crates/` is empty and vanishes; `desktop/target/` is ignored build output).

Environment → `ops/`: `compose.personal.yml`, `compose.development.yml`,
`.env.development.example`, `.env.example`, `.env.personal.example`,
`scripts/{development,personal}-instance`.

Release/CI tooling: `scripts/{verify,publish}-deployment-ref` →
`tooling/release/`; `scripts/check_pr_description.rb` → `tooling/`.

Staying at root (frozen tree): `package.json`, `package-lock.json`
(scripts/imports repointed into `apps/web/`), `Cargo.toml`, `Cargo.lock`
(members → `crates/local-store` + `apps/desktop/src-tauri`), `crates/`,
`packages/`, `tests/`, `docs/`, `bin/check`, `.github/`, `.gitignore`
(anchors updated), `.dockerignore` (stays: it configures the root build
context), `README.md`, `AGENTS.md`, `ELEF-DOCTRINE.md`, `LICENSE`,
`.devcontainer/` (no moved-path refs).

Reference updates (all root-layout references, Phase-00 set first):
baseline `hosts_and_deployment`/`build_references`/`root_layout` paths,
workflows, compose/env/Dockerfile paths, `bin/check` + ownership/boundary/arch
scripts, e2e runner configs + spec imports (`../../../test/e2e` →
`../../../../apps/web/test/e2e`), conformance adapter imports, benchmark paths,
fixture scripts, `assets.rb` packages path, tailwind `@source` depth, runbook +
durable docs + README/AGENTS (same commits, `$docs-sync`).

Non-goals (explicitly deferred to later phases):
- No product behavior change of any kind (P11-04; enforced by the Phase 10 scenario battery).
- No `script/` → `tooling/` migration: `script/` moves intact with the app (all entries app-coupled); tooling-shape questions belong to Phase 12 cleanup.
- No `spec/` creation (target tree lists it; no phase contract requires it).
- No deletion of retired `scripts/elef-agent` (banned from use, left untouched).
- No remote/macOS execution: remote runners stay CI-config-covered with results recorded when available, never mocked (P11-05).
- No live cutover: the Mac mini watcher re-pointing and live verification are H4 (owner), recorded pending per P11-06.

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `git mv` of Rails tree → `apps/web/` | web host (pure relocation, owner-preserving) | Host tree move; zero semantic change |
| `git mv` of desktop tree → `apps/desktop/` | desktop host (pure relocation) | Host tree move; zero semantic change |
| Compose/env/instances → `ops/` | `ops` (environment operations) | Environment unit; multi-service definitions + per-env config, not app logic |
| Release pair → `tooling/release/`; PR-description check → `tooling/` | `tooling` (release/CI tooling) | Repo-level tooling; executables, not app logic |
| Manifest + reference updates (Cargo members, npm scripts/imports, assets/tailwind paths, checker paths, workflow paths) | `tooling` (via `bin/`) + each file's existing owner for content | Shared repo verification + per-file mechanical repointing |
| Runbook + durable docs path updates (+ H4 cutover note) | `docs/` | Shared; docs describe the tree at every checkpoint (I09) |
| `packages/client` import preserved for desktop build | `client` (unchanged) | Shared bundle consumed via workspace + app integration modules |

Package admission (only if a package/crate/top-level dir is added): no new
package. `apps/`, `ops/`, `tooling/release/` are constitution-frozen
boundaries (§4 target tree), not new architecture.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| All Phase 00–10 behavior incl. Phase 10 scenario names/results | Full battery at candidate: quick + affected + Rails 346 + system 224 + desktop e2e 90 + web e2e (export + capability) + client/work-model/renderer/contracts/cargo suites + benchmark 20/20 |
| Production image builds and boots; dev stack boots | Throwaway compose build+boot dry runs (P11-03) + local smoke-job parity (P11-05) |
| Release authorization semantics unchanged | `tooling/release/*` + publish job path review (execution stays push-gated; dry-run arg parsing where supported) |
| Deploy-ref publication still CI-gated on exact tested tree | Workflow `needs` + attestation steps unchanged in behavior (paths only) |

Intended behavior changes (only those named by the phase contract):
- None. Paths change; behavior must not (P11-04).

## 5. Work breakdown
Ordered steps; pure moves and reference edits in separate commits.
1. DO-1 (pure move): `git mv` Rails tree → `apps/web/` (manifest §2). No content edits. Commit.
2. DO-2 (pure move): `git mv` desktop tree → `apps/desktop/`. Commit.
3. DO-3 (pure move): `git mv` ops/tooling placements (§2). Commit.
4. DO-4 (references): repo manifests — Cargo members, npm scripts/imports, `.gitignore` anchors, tailwind `@source`, `assets.rb` packages path. `git mv`-fidelity check: `git diff --cached --find-renames` shows renames + the small reference diff. Commit.
5. DO-5 (references): checker/tooling paths — `bin/check` constants, ownership/boundary/arch scripts, conformance imports, e2e runner configs + spec scenario imports, benchmark + fixture scripts. `bin/check quick` green. Commit.
6. DO-6 (prove): Rails battery from the new layout — affected (incl. rails conformance), full `bin/rails test`, JS suites. Commit (no-op if green; fixes land here if paths were missed).
7. DO-7 (prove): desktop rebuild (debug + release) + e2e harness 90/90 + web e2e + benchmark 20/20 from the new layout. Commit fixes if any.
8. DO-8 (references + prove): CI workflows repointed (all jobs) + local per-group P11-05 battery (§8 matrix). Commit.
9. DO-9 (prove): Dockerfile/compose/env repointed + throwaway dry-run builds/boots (prod + dev stacks) + release-script review. Commit.
10. DO-10 (docs): durable docs + runbook + README/AGENTS path updates, H4 cutover note, HD-01 line citations re-verified (fixes the Phase 10 review observation as a side effect of the spec move). Commit.
11. DO-11 (tooling): Phase 11 gate in `bin/check` (layout assertions + reference sweep + H4 record check); full proof map (§8); freeze candidate.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| (no temp compat paths) | — | Every in-checkout reference is updated in-phase; the out-of-checkout watcher cutover is H4 by contract (P11-06). Deploy refs advance only from dev/main after CI, so the live system cannot auto-deploy the new layout before the owner merges and performs H4. Compat shims for an unknown host-side interface would be guessing; the runbook H4 note documents the cutover instead. | — |
| `desktop/crates/` (empty dir) | desktop host | Nothing tracked inside; vanishes in the move | Immediate (DO-2) |
| Retired `scripts/elef-agent` | — | Explicitly untouched (banned from use, out of scope) | Not this phase |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| A moved-path reference is missed | Any suite/check/workflow step fails on paths | Fix the reference in the owning DO step; re-run the failing tier (never weaken) |
| Asset pipeline breaks (packages serving, tailwind, importmap) | `assets:precompile`, tailwind diff, or browser suites fail | Fix `assets.rb`/`@source`/importmap; reprove with the affected tier + one browser suite |
| Compose build context wrong | Dry-run build fails | Adjust COPY/WORKDIR/context (design: root context, `dockerfile: apps/web/Dockerfile`, `WORKDIR /rails/apps/web`); rerun dry run |
| Desktop rebuild breaks (workspace members, tauri conf) | Cargo/tauri build fails | Fix members/paths; rebuild; rerun e2e |
| /tmp pressure crashes browser suites (512M tmpfs) | Selenium tab-crash / ENOSPC | Clear `/tmp/elef-client-tests-*` + rerun; serialize groups (proven procedure) |
| OOM/resource kill under parallel load | Exit 137 / `Killed` / tab-crash under pressure | Reduce concurrency, isolate, rerun before classification (§6); record both runs |

Rollback reference: `phase_base_sha` `a08832a3efcaa949deefc7c713f8787e67d09179`.

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P11-01 host roots | `apps/web` + `apps/desktop` contain the moved trees; old roots absent (`test ! -e app config db desktop script Gemfile ...` finite checklist in gate); `git log --find-renames` shows the moves | gate + reviewer | — |
| P11-02 file split | Dockerfile/Procfile/dev-bin in `apps/web`; compose/env/instances in `ops/`; release pair in `tooling/release/`; PR check in `tooling/` (gate path assertions) | gate + reviewer | — |
| P11-03 references + dry run | Reference sweep: zero stale root-layout refs (gate grep over moved-root patterns in tracked files, allowlisting history/frozen records); throwaway prod compose build+boot+`/up` smoke and dev stack boot from the new layout (evidence logs) | gate + dry-run evidence | docker daemon + compose |
| P11-04 no behavior change | Phase 10 battery green at candidate with identical scenario names/counts: quick, affected, rails 346, system 224, desktop e2e 90, web e2e, client 99, work-model 51, renderer 14, contracts, cargo, benchmark 20/20 | quick→affected→suites | PG + browsers + Tauri runner |
| P11-05 CI groups | Local matrix: desktop-fast, scan_ruby, scan_js, test, sqlite-test, system-test, desktop, affected, production-smoke, development-smoke, hygiene-description, release-linux bundle steps — each green locally; workflows still configure desktop-macos/renderer-macos/release-macos/publish/attestation/publish-ref (config review, remote results recorded when available, never mocked) | suites + config review | docker + PG + browsers + Rust |
| P11-06 H4 | `pending_human_gates` records H4 (owner live Mac mini deployment) unless the owner performs it; runbook H4 cutover note present | reviewer | owner iff available |
| I01/I16/I17 boundaries | `bin/check arch` green from new layout; no allowlist growth (diff) | quick | — |
| I09 docs/state reality | Durable docs + runbook describe the new tree (reviewer); status validates | reviewer | — |
| I10 perf locked | No budget/baseline/threshold file touched (diff); benchmark 20/20 + baseline-identical miss profile | benchmark | Tauri runner |
| I14 no weakening | Zero test/baseline/threshold weakening (diff audit; additions only) | reviewer | — |
| I15 `all` twice clean | N.A. — Phase 12 requirement per §7 schedule; stubs verified nonzero | quick (stubs) | — |

Fixed fixture sets / finite reviewer checklists required by the contract:
- Move manifest (§2) audited against `git log --find-renames` + old-root absence checks.
- Reference sweep patterns + allowlist (history/frozen records) in the gate.
- P11-05 local group matrix with per-group command + exit evidence.
- H4 record + runbook cutover note.

Human gates touched (constitution §8): H4 recorded pending (owner live Mac mini
deployment after host rehome) unless the owner performs it during the phase;
gates 1–3, 5 remain pending as before (not triggered by this phase).

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
