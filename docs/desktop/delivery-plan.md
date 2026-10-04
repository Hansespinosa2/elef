# Elef Desktop — Delivery Plan

Status: draft v3 (2026-10-01). Replaces `v1-scope.md` and `spikes.md`. The milestone contract: "usable soon for notes and presentations on both devices" is the bar; everything else is stretch or later. What "done" means is in [requirements.md](requirements.md) §9; this file says in what order and on what evidence.

## 1. Scope

**In for v1**
- Tauri shell: window, single instance, File / Edit / View / Presentation / Window / Help menus; About is in the macOS application menu and Help on Linux. File includes New, Open, Save, Export, Import, Print, and library/settings actions.
- Library: list decks from a folder, open, create, rename (folder rename), delete to OS trash, local search, and a document graph derived from `[[title]]` links.
- Editors: source editor + visual editor, the real editing flow (reused JS).
- Auto-save (debounced), session-only undo/redo, conflict UI ([ADR-008](adr/008-safe-writes-and-conflict-detection.md)).
- Images: insert, display, stored under `images/`, served via the asset protocol.
- Rendering: shared JS `renderPreview` and Markdown block renderer plus shared slide/document structure and editor maps ([ADR-007](adr/007-single-shared-js-renderer.md)) — Markdown → HTML, KaTeX, Highlight.js, local media and Mermaid placeholders. Rails provides web routes and Active Storage URLs; desktop provides deck-local IDs and asset URLs. Full consumer-fixture parity, target performance evidence, and Ruby renderer removal remain in M3/M3w.
- `.elef` export/import with import hardening; `elef.json` auto-create; `.elef/` library config.
- Security model ([security.md](security.md)).
- Auto-update from day one (Tauri updater + GitHub Releases, [ADR-009](adr/009-distribution-and-update-channel.md)).
- macOS (Apple Silicon) and Linux builds.

**Flagged off in v1:** revisions UI and history; lineage graph. Both labeled experimental/deferred in copy and docs.

**In v1:** presentation mode and keyboard slide navigation; rendered preview can be printed through the native OS print dialog. The native dialog is the basic print fallback; a custom PDF export flow remains out of scope.

**Out of v1:** cross-device sync (manual move via folders/`.elef`); SQLite cache (no v1 consumer); custom PDF export; deep OS integration beyond `.elef`; Windows; PPTX export; network bug reports.

## 2. Feature flag register

Flags are debt. Each has an owner (Andres), a default per product, and a removal condition. Desktop defaults and their shared DOM behavior live in `app/javascript/lib/feature_flags.js`; the frontend applies them before mounting UI, marked controls fail closed, and CI checks the defaults against this table.

| Flag | Desktop v1 | Web | Removal condition |
|---|---|---|---|
| `ELEF_ENABLE_REVISIONS` | off | on | Revisions ship on desktop under the ADR-005 no-folder-clutter rule, or the feature is dropped from web |
| `ELEF_ENABLE_LINEAGE` | off | on | Same |
| `ELEF_RENDERER` (`ruby` \| `js`) | n/a (always JS) | `ruby` until the cutover gate, then `js` | Ruby renderer deleted (M3w) |

## 3. Milestones

Each ends with a usable app, not a branch. Critical path: M0 → M1 → M2 → (M3 ∥ M3w) → M4 → M5.

| # | Milestone | Done when (measurable) |
|---|---|---|
| M0 | Spikes | S1–S5 exit criteria met; ADR-002/003/006/007 accepted on results |
| M1 | Shell + library | App opens < 1.5 s cold; lists the 1,000-deck fixture < 500 ms warm; menus work; `.elef/` config persists; hostile-deck fixtures neutralized (QS-4) |
| M2 | Editor + files | Reused editor JS edits and auto-saves; fault-injection matrix passes (QS-2); external edit never silently clobbered (QS-3); `elef.json` auto-created; images work |
| M3 | Desktop rendering | Shared Markdown blocks render through the worker; desktop presentation and document projections match the Rails fixture suite after normalization; open 100-slide deck < 300 ms; presentation and print flows pass real-binary scenarios |
| M3w | Rails cutover (parallel track) | `ELEF_RENDERER=js` on Rails passes the full web suite; soak period with no renderer regressions (length: Q9); Ruby renderer deleted; fixtures regenerated, comparison exact; QS-7 fitness checks green |
| M4 | Portability + updates | `.elef` round-trip passes the per-file hash check; N-1 → N update works; failure injections leave the old version runnable (QS-8) |
| M5 | Test matrix + release | Tiered suite green on macOS + Linux; budgets met; Andres completes a week of real work on both devices with no data loss |

M3 and M3w are split in v3 because the cutover changes the production web app, while M3 only changes the new desktop app. They share renderer source and fixtures but have different risk and rollback. Desktop presentation mode and shared editable projection generation are implemented; M3 is not complete until the broader fixture corpus and supported-device performance budgets pass. Whether the desktop *release* waits for M3w is Q9.

Definition of done for every milestone: scenarios green; the affected docs and ADR statuses updated in the same PR; fitness checks green.

## 4. Spikes — evidence before commitment

Each is a day or less with a checkable exit. ADRs 002, 003, 006 and 007 are accepted on spike results, not on a nod.

**S1 — Rails-side inventory** (feeds ADR-003, 004, 007; [transport-adapter.md](transport-adapter.md))
- Every endpoint the editor/library JS calls: method, path, request/response JSON, error shapes → complete the command table.
- Host page: everything `works/_form.html.erb` injects that JS depends on (`data-*`, registry JSON, CSRF meta) → desktop static shell at `desktop/frontend/index.html`; both hosts mount app-owned components.
- Asset pipeline: importmap pins and npm lockfile; esbuild builds the checked-in renderer bundle; npm KaTeX is version-pinned to the gem's vendored runtime.
- Turbo: confirm no controller depends on Turbo events or navigation.
- Autosave controller: confirm it keeps dirty state and does not retry destructively on an error response.
- Preview DOM sink: record how preview HTML reaches the DOM (security C11).
- **Renderer consumers:** every server-side call site of `Source::HtmlRenderer` (preview endpoint, exports, cached-HTML paths). The mini_racer wrapper must cover all of them.
- **mini_racer feasibility:** local Omarchy install, timeout, memory limit, basic multithread context isolation, and a post-fork probe passed. Still measure 100-slide latency, exercise the Rails production Puma thread/fork configuration, and run install/render tests on macOS arm64. Highlight.js is used (no Shiki WebAssembly engine).
- **Bundle build:** implemented: root `npm run renderer:build` creates the Rails-owned bundle from `app/javascript`; the Node-only Tauri frontend build copies it, the checked-in `app/assets/builds/tailwind.css`, and the shell assets into the thin host. Separate root and desktop lockfiles pin shared renderer and Tauri dependencies; CI asserts the generated renderer and Tailwind assets are fresh and checks dependency direction.
- **Half-day probe:** shared Markdown blocks, editor maps and editable projections run through MiniRacer and targeted Rails tests pass. Still compare a representative fixture corpus through all Rails render consumers and both platform URL/media inputs.
- **Exit:** command table + payload schemas + host-page contract + full renderer consumer inventory + normalized parity corpus + MiniRacer target/thread/fork/performance evidence + bundle freshness check, reviewed against Rails controllers and system tests.

**S2 — Testing feasibility** (feeds [test-strategy.md](test-strategy.md))
- Shared scenario functions run against Rails in Chromium through Playwright and the real Tauri binary through WebdriverIO and its embedded WebDriver plugin. Linux CI uses a headless display; macOS CI builds and launches the arm64 app.
- WebDriver is compiled only into the E2E binary, with a dedicated localhost-only capability. Production config and default Cargo features exclude it; CI checks that separation.
- **Exit:** the shared web and native scenarios pass on Linux and macOS CI. If either platform fails, revise the test strategy before M1.

**S3 — macOS unsigned install and updater UX**
- First-install Gatekeeper UX for the unsigned build on current macOS (verify the override path on macOS 15+), and the full updater cycle: install N-1 → update → N → relaunch, with Ed25519 verification.
- **Exit:** documented UX with screenshots; any surprise becomes a v1-scope decision, not a release-week discovery.

**S4 — Linux packaging on Arch/Omarchy**
- AppImage builds, runs on Omarchy/Arch, and the update cycle works.
- **Exit:** install → update → relaunch green on Arch.

**S5 — Hostile-deck IPC probe** (feeds ADR-006, [security.md](security.md))
- In a real Tauri build on macOS and Linux with the pinned Tauri version, open a deck engineered to attempt: invoking commands from rendered content, `fetch` to remote hosts, posting to the parent frame, loading remote and `data:` resources, and inline script. Confirm none succeed.
- Find the tightest CSP that still works with CodeMirror and KaTeX; record it in security.md. Benchmark a second-pass sanitizer at the DOM sink.
- **Runtime probe result:** the shared hostile-deck workflow exercises script, event-handler, frame, parent-message, remote-fetch, unsafe-link, and remote/data-media payloads in the real Tauri WebView on both CI operating systems. It also verifies the attempted `create_deck` IPC side effect is absent. The exact-SHA run and scope are recorded in [spike-results/S5-hostile-deck-probe.md](spike-results/S5-hostile-deck-probe.md).
- **Exit:** every attack in the probe is neutralized on both OSes, or the failures become ADR-006 changes before M1. That runtime criterion passed; sanitizer timing characterization remains a follow-up measurement and is not represented as a security proof.

## 5. Human gates

A person must do these:
- Generate the updater Ed25519 keypair; store the private key as a repo secret **and** keep two offline encrypted backups (loss means every installed copy needs a manual reinstall — ADR-009).
- First real-device test on the MacBook Air (S3 covers the flow; a human confirms the feel).
- "Week of real work": Andres uses the v1 build for real notes and presentations with no data loss — the final acceptance criterion.

## 6. Executor prompt conventions

Prompts target `origin/dev`, reproduce-first, green CI, PR unmerged unless asked. Each prompt cites: this file, [architecture.md](architecture.md), the relevant ADR(s), and the seam spec for the milestone — [transport-adapter.md](transport-adapter.md) for M2, [data-format.md](data-format.md) for M4, [security.md](security.md) for M1 and M2, [test-strategy.md](test-strategy.md) throughout.
