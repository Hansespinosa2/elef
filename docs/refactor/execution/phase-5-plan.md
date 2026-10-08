# Phase 5 plan — Shared settings and appearance

Status: FROZEN at 2026-10-08 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/05-settings.md` (sha256 `94bb77f5e36623c4dc29f559ac7f24edeb753d9f2589cae62343090fa40fd19e`)
Phase base: `0f62a074ee5783cc6510801be2e39074264bc4ab`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| Contract declares `SettingsPort` (`getSettings`/`updateSettings` over `ProductSettings`) on `ElefHost.settings`; `HostCapabilities` = six booleans incl. `updater` | `packages/contracts/src/ports.ts:42-46`, `errors.ts:21-28`, `host.ts:13-22` |
| Both production adapters implement `settings`; Rails = REST `GET`/`PATCH /api/host/settings`, Tauri = `read_library_config` invoke + read-merge-`write_library_config` | `app/javascript/host/rails-http-host.js:311-318`, `desktop/frontend/src/tauri-host.js:320-328` |
| `capabilities.updater` is `false` on Rails, `true` on Tauri (with `nativeMenus`, `localFilesystem` also desktop-only) | `rails-http-host.js:365-372`, `tauri-host.js:377-384` |
| Conformance suite already covers settings round-trip identically on all adapters (get → update `{theme:"light"}` → reread → restore) + fake host implements it | `tests/host-conformance/suite.js:226-234`, `adapters/fake-host.js:221-227` |
| Zero product UI calls `host.settings` today (scoped grep over app/packages/desktop/tests, excl. node_modules/dist/tmp) | `grep getSettings\|updateSettings` → only adapters + fake + suite + contract |
| Web settings page = server form for workspace defaults (theme/typography) + vim-settings Stimulus mount point | `app/views/workspace_settings/show.html.erb:1-30`, `workspace_settings_controller.rb:8-22` |
| `/api/host/settings` JSON backend reads/writes `Workspace#default_theme/#default_typography` via `update_style_defaults` | `app/controllers/host_api_controller.rb:82-93,149-152` |
| Vim preferences are device-local: localStorage keys via `controllers/vim_preferences`, "for this device" copy, bridge to the active `.source-field` editor | `vim_settings_controller.js:1-75`, `lib/vim_settings_view.js:4` |
| Appearance controller is per-document editor UI: writes theme/typography into source frontmatter via `@elef/work-model`, no host calls, coupled to the editor form + `.source-field` controller | `controllers/appearance_controller.js:1-109` |
| Authoring dialog (395 lines, DOM-built, host-agnostic) takes injected `{readRegistries, writeRegistry, reloadEditorRegistry, renderMarkdownBlock, onClose}` | `lib/authoring_settings_dialog.js:73-86` |
| Rails authoring transport = fetch + CSRF + same-origin, one-entry-at-a-time writes, Rails status→code mapping | `lib/rails_authoring_settings_transport.js:23-120` |
| Desktop authoring = `read_authoring_registries` invoke merged over committed built-in JSON; no write path; reuses Rails-owned `lib/` + `controllers/` modules relatively | `desktop/frontend/src/authoring-registry-loader.js:1-30` |
| Settings styles live only in `app/assets/stylesheets/components/settings.css` (188 lines, `.elef-app`-scoped + settings-navigation/snippet classes); desktop owns no settings stylesheet | `settings.css:1-40`, `find desktop/frontend -name *.css` → node_modules + build outputs only |
| Tauri updater plugin is configured (signed, GitHub releases endpoint, placeholder pubkey); no updater UI exists in either host | `desktop/src-tauri/tauri.conf.json` plugins.updater; repo search `updater\|update-available\|check-for-update` → no UI |
| Client has `application/` (mountElef + `ElefMountOptions` seam: navigate/resolve*/confirmDelete/presentWork/extraCardActions/onLibraryEvent), `features/library/`, `ui/`; no settings feature yet | `packages/client/src/{application,shell.tsx,types.ts:19-42}`, `features/` = `library` only |
| Client dist is committed and served to browsers via the `packages/` asset load path + importmap pins; desktop consumes committed dist byte-identically (phase-4 precedent) | `config/initializers/assets.rb:10-11`, `config/importmap.rb:41-43` |
| `mountElef` contract signature in `packages/contracts` names only `initialUrl`; the wider implemented seam (navigate/resolve*/...) lives in client `types.ts` (phase-4 §9 re-plan note) | `contracts/src/host.ts:24-28` vs `client/src/application/types.ts:19-42` |

Open questions / unknowns (each is a blocker or has a resolution step): none. Judgment calls (§2 updater seam shape, vim storage seam, appearance scoping, CSS artifact shape) are decided below with proof in §8.

## 2. Scope
In scope:
- `packages/client/src/features/settings/`: one shared settings capability —
  - workspace-defaults form (theme/typography) backed by `host.settings` round-trip;
  - vim-preferences UI (shared component; device-local persistence behind an injectable storage defaulting to `localStorage`, which both hosts provide);
  - authoring-registries dialog (shared component ported from `authoring_settings_dialog.js`) backed by a host-provided registry-transport seam (`readRegistries`/`writeRegistry`; pure registry semantics — entry build/merge/write-diff — move into client with it);
  - updater affordance (shared component rendered iff `capabilities.updater`; status/actions arrive via an optional `ElefMountOptions.updater` seam — never a host-name branch).
- Shared built-in authoring registry data moves to client (both hosts consume the same built-ins).
- Client-owned settings stylesheet: `settings.css` moves to `packages/client/` (copied verbatim into committed dist by `build.mjs`, served through the same asset mechanism as the dist JS pins); both hosts load it; no host settings stylesheet may exist.
- Host switch-over: `/settings` serves the shell page mounting the client settings route (Rails adapter); desktop settings view boots `mountElef` (Tauri adapter); Rails authoring transport becomes the Rails seam impl under `app/javascript/host/`; Tauri seam impl (read via existing invoke + new `write_authoring_registries` command) under `desktop/frontend/src/`.
- Shared settings/appearance scenarios specified once (`test/e2e/scenarios/`), executed on web + desktop; client unit/integration tests vs fake host (memory storage).
- `bin/check phase 5` gate (phase-4 pattern), boundary rules for P05-01/P05-03/P05-04, docs/architecture.md settings row.

Non-goals (explicitly deferred to later phases):
- Per-document appearance panel (`appearance_controller.js` + editor-form coupling) stays until the editor phases (08/09); its value semantics are already shared via `@elef/work-model`. Rationale: it is editor UI, not product/host settings, and cannot mount without the editor lifecycle.
- Session/editing lifecycle (Phase 08), graph engine (Phase 06), export (Phase 07).
- New contract ports/capabilities. The updater status and registry transports ride the `ElefMountOptions`/adapter seam pattern from Phase 04 (optional host contributions, capability-gated), not new ports — admitted only with all-adapter conformance when a later phase needs them.
- `spec/` layout, `apps/` rehome (Phase 11), client CSS processing (the stylesheet is copied verbatim; no new toolchain).

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `features/settings/` (defaults form, vim UI, authoring dialog, updater affordance, registry semantics, built-in registry data) | `client` | Shared: one implementation mounted by both hosts through ports + seams |
| Settings stylesheet (moved from `app/assets/.../settings.css`) | `client` | Shared: one owner, one artifact, loaded by both hosts (P05-04) |
| Vim device-storage seam (injectable, `localStorage` default) | `client` | Shared: both hosts provide DOM localStorage; fake/memory in tests |
| Rails registry transport (`fetch`+CSRF REST) under `app/javascript/host/` | web host | Host-specific: Rails session auth + REST shape exist only on web |
| Tauri registry transport (invoke read/write + merge) under `desktop/frontend/src/` + `write_authoring_registries` command | desktop host | Host-specific: Tauri IPC + local config file exist only on desktop |
| Rails `/settings` shell page + adapter mount; `host_api` settings JSON (unchanged shape) | web host | Host-specific: Rails routing/rendering; JSON shape is the frozen port backend |
| Desktop settings boot + Tauri adapter (incl. updater status seam impl) | desktop host | Host-specific: Tauri bootstrap/IPC/updater plugin |
| Optional `ElefMountOptions.updater` status seam | `client` (shape) / hosts (impl) | Shared shape, host-specific impl — Phase-04 seam precedent; gated by `capabilities.updater` |
| Per-document appearance panel | editor (Phases 08/09) | Host-mounted editor UI; out of scope (see §2) |

Package admission: no new package/crate/top-level directory. Settings lives in `packages/client/src/features/settings/` (a module inside its semantic owner by default).

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| Workspace defaults round-trip (theme/typography) on both hosts, invalid input rejected | conformance `settings.round-trip` (all adapters) + shared settings scenario incl. invalid-choice rejection |
| Vim preferences persist per device and keep driving the active editor | shared scenario (toggle + escape-key + line-numbers) + client unit tests with memory storage |
| Authoring dialog lists/searches/edits/deletes snippets + math shortcuts one entry at a time with Rails error codes | shared authoring scenario on both adapters; hostile/markdown example rendering byte-identical |
| `/settings` deep link renders the settings UI; vim + authoring entry points reachable | system test on `/settings` + shared scenarios via shell route |
| Desktop offline (no Rails/Ruby), updater affordance only where `capabilities.updater` | `desktop.spec.js` offline + capability matrix tests; Rails shows no updater UI |
| Native benchmark probes within locked policy (client bundle grows: settings stays in the main bundle, no new deferred chunk unless coldStart regresses) | CI `benchmark-native.mjs` linux+mac artifacts vs `baseline.json product_performance` |

Intended behavior changes (only those named by the phase contract): P05-03's updater affordance is new shared UI — desktop gains an update affordance driven by its updater seam (Rails renders none). Desktop gains authoring-registry editing through the shared dialog (previously read-only loader) via the new Tauri write command. Both are the contract's "capability-dependent UI" made real; no existing behavior changes shape.

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits.
1. Scaffold `features/settings/` (defaults form vs fake host; vim UI with memory storage; `ElefMountOptions.updater?` seam type; capability-gated updater affordance). Prove: `npm test --prefix packages/client` + typecheck in `quick`.
2. Move registry semantics + dialog: port `authoring_settings_dialog.js` (host-agnostic core) + entry build/merge/write-diff into client; keep `#elef/*` Rails aliases out (pure moves). Prove: client unit tests incl. one-entry-at-a-time + error-code mapping.
3. Keep the single settings stylesheet in the shared `application.css` bundle both hosts compile (Rails via Propshaft, desktop via esbuild import of the same file); add P05-04 boundary/arch assertions — exactly one settings stylesheet in the repo, the desktop host stylesheet styles no shared settings class, and every settings class the client renders resolves in `application.css`. Prove: boundary rule + arch check + style-parity scenarios unchanged.
4. Host seam impls: Rails registry transport → `app/javascript/host/` (pure move + repoint); Tauri registry transport + `write_authoring_registries` command; updater seam impl on desktop. Prove: conformance suite imports unchanged production adapters, all three green.
5. Web switch-over: `/settings` shell page mounting client settings route; vim + authoring Stimulus controllers deleted after repoint. Prove: system test + shared scenarios on web.
6. Desktop switch-over: settings view boots `mountElef`; old loader/merge wiring deleted. Prove: `desktop.spec.js` settings flows + offline.
7. Shared scenarios `test/e2e/scenarios/` settings + authoring flows green in `web.spec.js` AND `desktop.spec.js`; `bin/check phase 5`.
8. Perf: benchmark comparison vs locked medians; docs/architecture.md settings row; gate + review to PASS.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| `app/views/workspace_settings/show.html.erb` server form | web host | Replaced by client defaults form | After web switch-over green (§5 step 5+7) |
| `app/javascript/controllers/vim_settings_controller.js`, `lib/vim_settings_view.js` | shared lib → client | Replaced by `features/settings` vim UI | After both hosts switched over (§5 steps 5-7) |
| `lib/authoring_settings_dialog.js`, registry helpers (`authoring_settings.js`, `authoring_registry_write.js`, `authoring_registry_merge.js`) | shared lib → client | Semantics move into client | At move time (§5 step 2); Rails transport does NOT move (it becomes the host seam impl) |
| `lib/rails_authoring_settings_transport.js` (relocated, not deleted) | shared lib → web host | It is the Rails seam implementation | At seam-impl time (§5 step 4); no lingering `lib/` copy |
| `desktop/frontend/src/authoring-registry-loader.js` merge wiring | desktop host | Replaced by Tauri seam impl | After desktop switch-over green (§5 step 6+7) |
| `app/assets/stylesheets/components/settings.css` | shared stylesheet (both hosts compile it) | P05-04 single owner by rule, not by move (see §9 2026-10-08) | No deletion; boundary rule forbids any second settings stylesheet, and the desktop host stylesheet must not restyle shared settings classes |
| `workspace_settings_controller.rb` HTML form handling (JSON errors stay only if the port backend needs them; `host_api` JSON unchanged) | web host | Server-rendered settings page gone | After web switch-over green; `host_api#settings_*` stays as the frozen port backend |
| Updater seam `ElefMountOptions.updater?` | client/hosts | Capability-gated host contribution (P05-03) | Permanent seam (updater existence is inherently host-specific), shape frozen this phase |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| Settings code in the main bundle regresses coldStart/warmLibrary probes | Probe median >10% over locked baseline, or new ceiling crossing | Roll back to phase base; split settings (or the dialog's markdown preview deps) into a deferred chunk like preview-core before retry |
| Turbo + settings mount lifecycle leaks/double-mounts | System tests flake or duplicate shell nodes on `/settings` | Fix mount/unmount idempotency (phase-4 pattern); rollback if unstable |
| Authoring write semantics diverge between adapters (Rails one-at-a-time vs Tauri file write) | Shared authoring scenario fails on either adapter | Align Tauri seam to the same one-entry/change-set contract; no adapter-specific dialog branches |
| Vim localStorage seam breaks desktop (webview storage policy) | Desktop vim scenario fails while web passes | Host-provided storage impl via seam (same shape, Tauri-backed file); dialog stays shared |
| Contract pressure (new ports demanded mid-phase) | A settings behavior cannot be expressed via ports + seams | STOP: contract change needs all-adapter conformance + plan re-freeze, not improvisation |
| Benchmark variance masks/fakes regressions | Medians swing >5% run-to-run on unchanged code | Compare medians over the 20-process protocol; use CI artifacts, not local single runs |

Rollback reference: `phase_base_sha` `0f62a074ee5783cc6510801be2e39074264bc4ab`.

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P05-01 sole settings implementation | `git ls-files` shows no `workspace_settings/show`, vim/authoring `lib/` originals, or Rails `settings.css`; settings UI exists only under `packages/client/src/features/settings/` (reviewer grep + file list) | phase + review | — |
| P05-02 round-trip, same tests | conformance `settings.round-trip` green on fake + rails-http + tauri adapters (existing suite, unchanged shape) | affected + CI | CI (both hosts); local Chromium leg |
| P05-03 capability branching | client unit tests: updater affordance renders with `updater:true`, absent with `updater:false`; boundary rule fails client on host-name tokens (`__TAURI__\|Tauri\|Rails\|ActiveRecord`) | quick + phase | — |
| P05-04 one style owner | boundary rule: exactly one `*settings*.css` in the repo (the shared bundle partial); desktop host stylesheet styles no client-rendered settings class; client settings classes resolve in `application.css` (arch check); reviewer `find` + class cross-check | phase + review | — |
| P05-05 scenarios both hosts | new/updated `test/e2e/scenarios/` settings + authoring flows green in `web.spec.js` AND `desktop.spec.js`; client unit/integration vs fake host green | affected + CI desktop jobs | CI (both hosts); local Chromium leg |
| I01/I16/I17 boundaries/admission/cycles | boundary rules + self-test green; no new package (§3); settings internal graph acyclic (rule) | quick/phase | — |
| I02/I04/I05/I08 | no duplicated settings impl; no renderer change; client has no host knowledge (P05-03 rule); no new dumping grounds | phase + review | — |
| I06/I07/I09/I13/I14 | data-safety suites green; desktop offline (arch check); docs factual; §6 deletion conditions honored; no weakened tests (scenarios extended, suite intact) | affected/phase/CI | — |
| I03/I10/I15/I18 | work-model untouched (appearance stays on `@elef/work-model`); perf (P05-07-style probe policy) ; `all` still stub; arch doc settings row → 5-min routing | phase + review | — |
| Gate | `bin/check phase 5 --json` exit 0 in isolated checkout + exact-candidate full CI green | phase + CI | CI |

Fixed fixture sets / finite reviewer checklists required by the contract: settings verb set = exactly workspace-defaults round-trip (theme/typography incl. invalid rejection), vim preferences (toggle/escape-key/line-numbers/mode-aware-cursor), authoring registries (list/search/create/update/delete, one-entry-at-a-time, Rails error codes); capability matrix = updater affordance present on Tauri (`updater:true`) and absent on Rails (`updater:false`); stylesheet set = exactly one client-owned settings CSS.

Human gates touched (constitution §8): none (no signing/device/deployment/soak impact; Tauri updater endpoint/pubkey rotation stays a human release concern outside this phase).

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
- 2026-10-08: §5 step 3 (move settings.css to packages/client + dist copy) invalidated in DO. Both hosts compile the same `app/assets/stylesheets/application.css` (Rails via Propshaft relative @imports; desktop via esbuild `import "../../../app/assets/stylesheets/application.css"` in main.js per check_architecture.py:78); the e2e style-baseline resolver (`web.spec.js readApplicationStylesheet`) honors only `./`-relative partials, so a move would silently diverge the desktop bundle from the web baseline and break style-parity scenarios. Resolution: keep the single stylesheet in the shared bundle (phase-04 library.css precedent); P05-04 is proven by boundary/arch rules (exactly one settings stylesheet, no host restyling of shared settings classes) instead of relocation. §5 step 3, §6 settings.css row and §8 P05-04 row rewritten above; no scope added or removed otherwise. Completed DO steps 1–2 preserved.
- 2026-10-08: §2 built-in registry data move (shared built-ins into packages/client) retained single-sourced instead. Both hosts already consume the same `app/javascript/data/default_authoring_registry.json` (desktop via relative JSON import in `authoring-registry-loader.js`/`main.js`; Rails via the artifact path in `authoring_registry_test.rb`; merge unit tests read the same file), so relocation would add a second copy or a cross-package path without changing the single-source fact P05-01/I02 require. Resolution: keep the file unmoved; no scope added or removed otherwise. Logged per round-1 review (P05R1-RESIDUAL-VIM-UI required fix).
