# Phase 4 plan — Shared client shell and library slice

Status: FROZEN at 2026-10-08 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/04-client-library.md` (sha256 `1c172f31ad0e9a4d511767a10c9439d6bff12b0fca7a4fc8b188f4fee0a0fd55`)
Phase base: `2bdfa86d6c6651b692a9c3bf11988309d52b27be`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| Phase-01 minimal shell `mountElef(hostElement, host, options?)` lists works via ports only, branches on `capabilities.updater`, supports `options.initialUrl` | `tests/host-conformance/shell.js:8-63` |
| Contract declares `mountElef` as the sole host entry point; `ElefHost` = capabilities + library/works/media/settings/search/transfer ports + `createWorkSession` | `packages/contracts/src/host.ts:12-27` |
| LibraryPort covers listWorkspaces/listWorks/createWork/renameWork/deleteWork; SearchPort covers query search; no fork/publish/preview/open ports | `packages/contracts/src/ports.ts:10-60` |
| Conformance suite v1 has 12 cases incl. `library.crud`, `search.echo-and-find`; runner-agnostic, suite-wide delete no-op for dialog-mediated hosts | `tests/host-conformance/suite.js:9,15,44,228,282` |
| Three adapters exist: fake (281 lines), rails-http (372, incl. library CRUD + `/search` JSON), tauri-invoke (319, `list_decks`/`create_deck`/`rename_deck`, workspace `local`) | `tests/host-conformance/adapters/*.js`, `rails-http-host.js:115-141,307`, `tauri-invoke-host.js:17,54-80` |
| Fake host mounts the shell with zero native processes; updater affordance is capability-gated | `tests/host-conformance/shell.test.js:8-43`, `conformance-fake.test.js:1-21` |
| Web library = server ERB: `library/index` (+`_work_card`, `_work_preview`), filter tabs all/documents/presentations, search box, slots for actions/graph/lineage/cards | `app/views/library/index.html.erb`, `config/routes.rb:2,27,52` |
| `documents#index`/`presentations#index` render `library/index` with `@filter` + graph/lineage instance data | `app/controllers/documents_controller.rb:8-14`, `presentations_controller.rb:9-14` |
| `library#index` lists `Work.recent_first`; `library#search` is a JSON API (`q`, `type`, `limit`) | `app/controllers/library_controller.rb:2-17` |
| Web card controls: rename form, presentation fork (continuation/inspiration), publish/present, delete confirm — server-rendered via `Source::JavascriptRenderer.library_card*` | `app/views/library/_work_card.html.erb:1-45` |
| Web enhancement is thin Stimulus: `library-search#filter` → shared `filterLibraryCards` | `app/javascript/controllers/library_search_controller.js:1-8`, `lib/library_filter.js` (31 lines) |
| Desktop boots `startFileLibraryApplication` (1223 lines vanilla JS) rendering editor + library views, with transports for file-library/media/preview/update/quiet-save | `app/javascript/lib/file_library_application.js:23-139`, `desktop/frontend/src/main.js:21-57` |
| Desktop has NO fork/publish/load-samples UI; web-only extras are fork, present/publish, load-samples buttons | `grep fork/publish/load_samples file_library_application.js` → only conflict-dialog/editor matches |
| Shared `lib/` modules used by desktop: `library_card` (`createLibraryCard`), `library_view` (template+`renderLibraryView`), `library_filter`, `library_preview`, `incremental_list`, `document_graph_cache`, `performance_measurement` | `file_library_application.js:1-9`, `app/javascript/lib/library_*.js` |
| Show pages (`/documents/:id`, `/presentations/:id`) are saved-work preview pages (render output, print/PDF, edit links), not library UI | `app/views/documents/show.html.erb:1-30` (44 lines) |
| Host API serves library ports as JSON: works index/create/show/update/rename/destroy, media, settings, imports; no fork/publish/search actions | `app/controllers/host_api_controller.rb:8-103`, `config/routes.rb:8-21` |
| No React in repo (zero package.json hits, no `node_modules/react`); root pins esbuild 0.25.11 + typescript 5.9; contracts is tsc-built, dist untracked | `grep '"react"' package.json desktop/*/package.json` → empty; `package.json:20,25`; `git ls-files packages/contracts/dist` → empty |
| React 19.3.0 + react-dom render works under linkedom in Node 22 `node:test` (no jsdom needed; `act` needs `IS_REACT_ACT_ENVIRONMENT`) | `/tmp/react-spike` probe → `RENDER: <button>hi</button>` |
| Desktop build: esbuild bundles `src/main.js` → `dist/assets/app.js`, aliases `lib/` → `app/javascript/lib`, copies `app/views/desktop_host.html` → `dist/index.html` | `desktop/frontend/build.mjs:21,48,69,75,154-160` |
| Web serves `@elef/*` sources via importmap pins; desktop test asserts production `app.js` has no `__elefPerformanceTestHooks`/`__elefPresentationTestHooks` | `config/importmap.rb:41-43`, `desktop/scripts/check_architecture.py:172-175` |
| Locked perf policy: coldStart budget 1500 (median 879.0), open100Slides budget 300 (median 1277, already missing), warmLibrary budget 500 (median 373.5); rule = ≤10% regression + no new ceiling crossing | `docs/refactor/baseline.json: product_performance` |
| Native benchmark runs in CI desktop jobs (linux + mac) against release binary; artifacts `native-performance-{linux,darwin}` | `.github/workflows/ci.yml:342,521`, phase-3 evidence artifacts |
| Shared e2e scenarios run in both hosts: `web.spec.js` + `desktop.spec.js` consume `test/e2e/scenarios/*.js` incl. `library-and-graph.js`, `library-create-delete.js` | `web.spec.js:889-893`, `desktop.spec.js:1880-1884` |
| Sanitizer is DOM-based `installSanitizedPreview` with inline hostile cases; stays app-side per phase-3 I11 | `app/javascript/lib/preview_sanitizer.js:22`, phase-3 review I11 |
| Durable docs do not route client work yet (no `client`/`mountElef` in architecture/development docs; only `transport-adapter.md` names the shared desktop start) | `grep -ri client docs/architecture.md` → empty; `docs/desktop/transport-adapter.md:7` |

Open questions / unknowns (each is a blocker or has a resolution step): none. Judgment calls (host-contribution seam §2, sanitizer move with fallback §5 step 4, dist shape §2) are decided below with proof in §8.

## 2. Scope
In scope:
- `packages/client` (React 19 + TS strict, ESM): `application/` (mountElef, library-link router, orchestration), `features/library/` (list/search/filter/create/open/rename/delete), `ui/` (primitives + SafeHtml sole raw-HTML boundary). P04-03's seven behaviors are the phase's "product library behavior" line.
- `dist/elef-client.js`: single-file esbuild bundle (React included, JS only; visual classes reuse the existing shared stylesheet both hosts load today). Hosts consume dist; freshness check extended. (`.js`, not `.mjs`: Propshaft serves unknown `.mjs` with an empty MIME so module scripts fail to load.)
- Host switch-over: Rails library routes (`/`, `/documents`, `/presentations`) serve a shell page mounting the same client with the Rails adapter + `initialUrl`; desktop `main.js` boots mountElef with the Tauri adapter (editor boot stays).
- Production adapters move to their hosts: Rails adapter → `app/javascript/host/rails-http-host.js`; Tauri adapter → `desktop/frontend/src/tauri-host.js`; conformance + e2e import the production implementations; fake host stays a `tests/` fixture.
- One documented host-contribution seam on `mountElef` options (`navigate`/`onOpenWork`, extra card actions, extra HTML slots): carries web-only fork/present/publish/load-samples, graph/lineage panels (to Phase 06), and host navigation. No new contract ports this phase.
- Shared client-library scenarios specified once, executed against Rails + Tauri adapters (extend `test/e2e/scenarios/` + client unit tests vs fake host).
- `bin/check phase 4` gate (phase-3 pattern), boundary rules for P04-05/P04-06, docs/architecture.md client row (I18).

Non-goals (explicitly deferred to later phases):
- `session/` editing lifecycle (Phase 08), editor integration beyond the open seam (Phases 08/09), graph engine (Phase 06), export (Phase 07), settings UI (Phase 05).
- Show/edit/print/palette flows, `/search` JSON API, `host_api` — unchanged (host-owned).
- New contract ports/capabilities; fork/publish/search ports admitted only with all-adapter conformance when a later phase needs them.
- `spec/` layout, `apps/` rehome (Phase 11), client CSS bundle (hosts keep serving the shared stylesheet).

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `packages/client` (application, features/library, ui incl. SafeHtml) | `client` | Shared: one implementation mounted by both hosts through ports |
| Client dist bundle + build script | `client` | Shared: one canonical artifact, consumed by both host packagers |
| Rails shell page + adapter + route wiring | web host (`apps/web`) | Host-specific: Rails routing/rendering/asset serving |
| Desktop boot wiring + Tauri adapter placement | desktop host (`apps/desktop`) | Host-specific: Tauri bootstrap/IPC transport |
| Host-contribution seam options (navigate, extra actions/slots) | `client` (seam shape) + hosts (contributions) | Seam shared; each contribution host-specific (no desktop fork/publish backend; URL vs view navigation) |
| Sanitizer move into `ui/SafeHtml` | `client` | Shared if platform-neutral (both hosts need identical hostile-HTML handling); else host seam (fallback, §5 step 4) |
| Deletion of ERB/Stimulus/`lib/library_*`/Phase-01 shell | old owners (web host, shared lib, tests) | Deletions, not behavior |
| Benchmark/perf comparison | `tooling` + CI | Shared measurement, no product code |

Package admission (`packages/client`): six criteria + driver, each with evidence.
1. One cohesive responsibility: the host-neutral interactive application (constitution §4 fixes this exact boundary).
2. Small stable public API: `mountElef(hostElement, host, options?)` + versioned options — one entry point (contracts `host.ts:23-27` declares it).
3. Acyclic machine-enforceable direction: client → work-model/renderer/contracts only (new boundary rule + existing R6 family); hosts → client dist.
4. Meaningful independent tests: client unit suite (fake host, linkedom-proven) + shared scenarios on both adapters.
5. Concrete payoff: deletes two divergent library implementations (1223-line desktop app boot + server ERB/Stimulus) and ends library drift; proves the host-neutral model for Phases 05-09.
6. Hides more than it exposes: React runtime, router, library state, preview rendering/sanitizing behind one mount call.
Driver: multiple architectural consumers (Rails host, Tauri host, fake host) + domain-kernel isolation (host-neutral UI kernel vs host shells). Toolchain note: React 19 is new to the repo but §6 fixes React+TS for client; esbuild/TS/lockfile already exist — no new runner, no separate lockfile.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| Library lists all works with kind tabs (all/documents/presentations) + counts | shared scenario (both hosts) + system test on `/`, `/documents`, `/presentations` |
| Search box filters visible cards client-side; no-results state | shared scenario + client unit tests (fake host) |
| Create work (document + presentation), rename inline, delete with confirm | shared scenario `library-create-delete` (extended) on both adapters |
| Open work → editor (web: edit page; desktop: editor view) | shared scenario asserting the navigate seam + host landing |
| Card shows rendered preview bytes identical to today's renderer output | hostile/exact-byte preview assertions in shared scenario + client unit tests |
| Web-only card actions (fork/present/publish/load-samples) and graph/lineage panels keep working | system tests (presentations/documents) + `library-and-graph` scenario, via host seam |
| Native benchmark probes within locked policy (≤10% of median; open100Slides regression-only, already over ceiling) | CI `benchmark-native.mjs` linux+mac artifacts vs `baseline.json product_performance` |
| Desktop offline (no Rails/Ruby), updater/capability gating | `desktop.spec.js` offline + capability tests, phase gate |

Intended behavior changes (only those named by the phase contract): none. P04-01's switch-over is structural (same library behavior, one implementation); P04-04 resolves the same URLs through the shell.

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits.
1. Scaffold `@elef/client` (package.json, tsconfig strict, esbuild dist script, `application/` shell with `mountElef` + router skeleton, `ui/` primitives). Prove: `npm test` (esbuild-bundled tests → `node:test` + linkedom) + typecheck in `quick`.
2. Move Phase-01 shell cases: port `shell.js` behavior into client, delete `shell.js`, repoint `shell.test.js` → client mount tests vs fake host (P04-02 fake leg).
3. Build `features/library/` (list/search/filter/create/open/rename/delete) against ports; previews via `@elef/renderer` + SafeHtml; navigate seam for open.
4. Sanitizer: verify `preview_sanitizer.js` is platform-neutral; move into `ui/SafeHtml` (preferred) or host-seam it (fallback). Prove: hostile fixtures identical in client unit tests + shared scenario.
5. Move adapters to hosts (pure moves + import repointing); conformance suite imports production adapters; all three adapters green.
6. Web switch-over: shell page + adapter mount on `/`, `/documents`, `/presentations` with `initialUrl` routing; Turbo mount/unmount lifecycle.
7. Desktop switch-over: `main.js` boots mountElef for library; editor boot untouched; dist consumed per §6.
8. Shared scenarios: new/updated `test/e2e/scenarios/` client-library flow(s) green in `web.spec.js` + `desktop.spec.js`; system tests for deep links.
9. Deletions (§6 table); boundary rules for P04-05/P04-06 + freshness for client dist; `bin/check phase 4`.
10. Perf: benchmark comparison vs locked medians; docs/architecture.md client row; gate + review to PASS.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| `app/views/library/*` (index, _work_card, _work_preview) | web host | Replaced by client render | After web switch-over green (§5 step 6+8) |
| `app/javascript/controllers/library_search*.js`, `lib/library_{view,card,filter,preview}.js` | shared lib | Replaced by `features/library` + `ui` | After both hosts switched over (§5 step 7+8) |
| `file_library_application.js` library boot (file shrinks to editor boot or splits) | shared lib → desktop host | Library boot replaced by mountElef | After desktop switch-over green (§5 step 7+8) |
| `tests/host-conformance/shell.js` (+`shell.test.js` repointed) | tests | Phase-01 minimal shell superseded | After client mount tests land (§5 step 2) |
| `tests/host-conformance/adapters/{rails,tauri}-*.js` (moved to hosts; thin re-export or updated imports) | tests → hosts | Adapters are host implementations | At move time (§5 step 5); no lingering copy |
| Host seam: extra card actions (fork/present/publish/load-samples) | web host | No desktop backend; no admitted ports | When fork/publish ports are admitted (later phase) or actions removed by owner |
| Host seam: extra HTML slots (graph/lineage panels) | web host | Graph engine is Phase 06 | Phase 06 migrates graph into `client/features/graph` |
| Host seam: `navigate`/open-work callback | both hosts | URL navigation vs in-app views differ by platform | Permanent seam (navigation target is inherently host-specific), shape frozen this phase |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| React bundle regresses coldStart/warmLibrary probes | Probe median >10% over locked baseline, or new ceiling crossing | Roll back to `2bdfa86`; shrink bundle (code-split, defer non-library code) before retry |
| Turbo + client mount lifecycle leaks/double-mounts | System tests flake or duplicate `[data-elef-shell]` nodes | Fix mount/unmount idempotency; rollback if web library unstable |
| Sanitizer move changes hostile-HTML handling | Hostile fixture bytes differ in any runner | Take fallback seam (host-provided sanitize); re-audit |
| Desktop editor boot coupling breaks when splitting `file_library_application.js` | `desktop.spec.js` editor flows fail | Keep file whole behind a narrower seam; split later |
| Benchmark variance masks/fakes regressions | Medians swing >5% run-to-run on unchanged code | Compare medians over the 20-process protocol; use CI artifacts, not local single runs |
| Contract pressure (new ports demanded mid-phase) | A library behavior cannot be expressed via ports + seam | STOP: contract change needs all-adapter conformance + plan re-freeze, not improvisation |

Rollback reference: `phase_base_sha` `2bdfa86d6c6651b692a9c3bf11988309d52b27be`.

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P04-01 sole implementation + old deleted | `git ls-files` shows no `app/views/library/*`, `library_search*`, `lib/library_*`; client is the only renderer of library UI (reviewer grep + file list) | phase + review | — |
| P04-02 same mountElef, fake mounts | Client mount tests vs fake host (`npm test --prefix packages/client`); web shell page + desktop `main.js` both call `mountElef` (grep + boot e2e) | quick + phase | — |
| P04-03 scenarios once, both adapters | `test/e2e/scenarios/` client-library flow(s) green in `web.spec.js` AND `desktop.spec.js`; client unit tests vs fake | affected + CI desktop jobs | CI (both hosts); local Chromium leg |
| P04-04 deep links via shell | System tests visit `/`, `/documents`, `/presentations` → client shell mounted with correct filter; `initialUrl` unit tests | affected + CI system-test | Rails (CI or local-Ruby agent setup) |
| P04-05 no host knowledge/branch | New boundary rule (client imports) + frozen grep (`__TAURI__|MiniRacer|ActiveRecord|rails|tauri` case-handled) in gate | phase | — |
| P04-06 no cross-feature deep imports | New boundary rule (features/ isolation, composition in `application/`) + self-test canary | phase | — |
| P04-07 perf policy holds | `benchmark-native.mjs` linux+mac artifacts vs `baseline.json` medians (≤10%, no new ceiling cross) | CI desktop jobs | CI release runners |
| I01/I16/I17 boundaries/admission/cycles | Boundary rules + self-test green; admission §3 recorded; client internal graph acyclic (rule) | quick/phase | — |
| I02/I04/I05/I08/I11/I12 | No duplicated library impl; renderer still pure; client purity (P04-05); client dist fresh (new freshness check); SafeHtml sole HTML boundary (grep + hostile fixtures); no new dumping grounds | phase + review | — |
| I06/I07/I09/I13/I14 | Data-safety suites green; desktop offline (no Rails in desktop closure — arch check); docs factual; seam deletion conditions in §6 table; no weakened tests (corpus intact, scenarios extended not replaced) | affected/phase/CI | — |
| I03/I10/I15/I18 | Work-model untouched; perf (P04-07) + warm ceilings; `all` still unimplemented-stub; arch doc client row → 5-min routing | phase + review | — |
| Gate | `bin/check phase 4 --json` exit 0 in isolated checkout + exact-candidate full CI green | phase + CI | CI |

Fixed fixture sets / finite reviewer checklists required by the contract: deep-link set = exactly `/`, `/documents`, `/presentations` (show/edit/print stay host-rendered); scenario verb set = exactly list/search/filter/create/open/rename/delete; host-seam surface = `navigate`, extra card actions, extra slots (§6 rows).

Human gates touched (constitution §8): none (no signing/device/deployment/soak impact).

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
- 2026-10-08: the fixed host-seam surface note in §8 (§6 rows: navigate, extra card actions, extra slots) understated the permanent control plane the desktop switch-over needed. Implemented surface, all permanent: navigation (`navigate`), host→client control (`notify`, `setFilter`), client→host reports (`onLibraryEvent`), content resolution (`resolveWorkUrl`, `resolveLibraryUrl`, `resolvePreviewUrl`, `resolveMediaBaseUrl`, `cardNote`, `operationNotice`, `confirmDelete`, `presentWork`, `extraCardActions`), and adopted HTML slots. No §6 deletion condition changes; the §6 rows still govern the temporary seams.
