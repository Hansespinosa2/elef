# Elef Desktop v0.x — Release Constitution

**Status:** Approved product/release requirements; implementation and end-to-end release not yet proven  
**Authority:** This document defines the v0.x desktop release project. Also follow `AGENTS.md`, `ELEF-DOCTRINE.md`, and `docs/architecture.md`; resolve conflicts without silently weakening either.  
**Scope:** Desktop Stable profile, packaging, tests, automated publication and updates, diagnostics, and safety. **No authoring redesign.**  
**Baseline:** Public `main` inspected 2026-10-09. File paths and implementation details below are leads, not substitutes for inspection of the checked-out SHA.

## 1. Product contract

**Purpose:** Ship the *existing* Elef authoring experience for personal testing on Apple Silicon macOS and Arch-compatible x86-64 Linux. Public v0.x releases are labeled **Personal testing**. No paid Apple Developer membership is required for v0.x. Developer ID signing/notarization is a v1.0 requirement, not a v0.x deliverable.

**Non-negotiable invariants**

1. **Preserve authoring.** No changes to source grammar, source-editor layout or interactions, shortcuts, preview/rendering semantics, save/close behavior, document/presentation UI, or file format except changes strictly necessary to disable excluded desktop Stable features. Do not incorporate an unrelated autosave/snapshot redesign into this project.
2. **Preserve Rails.** Rails `app/` owns shared UI, authoring and rendering; desktop consumes it, never vice versa. Rails web retains its full existing feature set in `main` and `dev`. Do not duplicate/fork the renderer or source editor.
3. **One installed Stable, repository-run Dev.** Stable is built only from an owner-approved change merged into `main`. Dev runs from the repository, retains experimental features, has isolated app state/library selection, and never uses the Stable public updater.
4. **User data first.** Libraries are ordinary selectable directories; Stable and Dev default to separate libraries and can exchange complete work folders by copying. No automatic incompatible file migration, rewriting of unsupported source, destructive test access to a real library, or loss of unsaved work.
5. **No false release claims.** A build is not an installation test, a CI test is not an actual user's device, and a configured publishing workflow is not a published release. Evidence and external blockers must be reported explicitly.

### Desktop-only feature profiles

| Capability | Desktop Stable | Repository Dev / Rails web |
|---|---|---|
| Library create/open/rename/delete/search | On | Existing behavior |
| Source editor, math shortcuts, Elef directives | On | Existing behavior |
| Live preview, presentation mode, images/local assets | On | Existing behavior |
| Print/PDF and `.elef` import/export | On | Existing behavior |
| Themes/typography, Mermaid, SmartArt | On | Existing behavior |
| Snippet palettes and authoring assistants | On | Existing behavior |
| Visual editor / direct visual manipulation | **Excluded** | Existing behavior |
| Document graph visualization | **Excluded** | Existing behavior |
| Revisions and lineage | **Excluded** | Existing behavior |
| `[[...]]` linking, resolution and link palette | **Excluded** | Existing behavior |

**Exclusion is behavioral and, where separable, physical.** Stable has no excluded UI, shortcuts, navigation, runtime initialization, native command permission or side effect. Exclude standalone experimental entry points/modules from the compiled Stable bundle; retain irreducible shared renderer/source utilities only when a documented dependency proves they are needed. Never remove ordinary Markdown links or corrupt literal `[[...]]` source. Preserve unsupported source across compatible open/save/export/import, whether or not Stable renders it.

Implement profile selection in **desktop-specific entry/configuration/build boundaries**, such as `desktop/frontend/src/main.js`, `desktop/frontend/build.mjs`, or explicit desktop-only adapters/aliases. Shared `app/javascript` modules may receive narrowly necessary, behavior-preserving modularization, but **not a global Stable flag that changes Rails behavior**. Verify both rendered behavior and module graph. A shared module being present in Stable is not evidence that an excluded feature runs, but any irreducible exception needs written proof.

**Checked-in exclusion inventory:** Before implementation, list excluded entry points/controllers/routes/native commands and any unavoidable shared dependencies in a small machine-readable inventory (choose an existing test-fixture location where practical). CI asserts that prohibited modules are absent from the Stable esbuild metafile and prohibited behaviors/commands are unreachable. Do not rely solely on string matching against minified bundles; use a runtime test for each excluded feature. An exception must name the dependent retained feature and have its own negative test.

## 2. Existing app identity, storage and offline guarantees

- Preserve Stable's existing Tauri identifier **`com.elef.desktop`**, app-data directory, selected-library state (`library-root.json`), file associations and library format. Prove a pre-release app-state fixture still opens the same library when v0.1.0 first launches. Do **not** silently reset user settings.
- Give Dev a separate **development-only** identifier (proposed `com.elef.desktop.dev`), app-data location, selected library and single-instance identity. No second published Dev installer. Users can choose alternative library folders explicitly; default selections must not collide.
- Historical compatibility fixtures must cover the current document and presentation formats and representative unsupported Dev directives. Newer releases open and round-trip them without source loss; a previous release round-trips newer *compatible* source without deleting unknown directives. Do not assert that an old renderer supports new constructs.
- Installed Stable must launch, edit, preview, save/reopen, present and export with external network denied and no Rails server. Update checks and optional online-dependent assistance can fail gracefully offline.

## 3. Platforms and update contract

### macOS — Apple Silicon ARM64

- Deliver a public DMG plus cryptographically signed Tauri updater archive and signature, linked to the same immutable source/version. **No Developer ID or notarization claim for v0.x.** Use ad-hoc signing for the v0.x app where the inspected Tauri version requires/supports it; verify its actual installation and macOS Gatekeeper first-launch approval steps on hardware, including after upgrading.
- Installed Stable checks the **controlled safe-version feed**, downloads and verifies an eligible newer version in the background, and applies it **only during a safe ordinary quit/relaunch**. No forced restart, user prompt for every update, or installation while edits remain unsaved. Reuse the existing native staging/activation/recovery code rather than replacing it without cause.
- A staged update must retain its version, signature and integrity metadata across restart. Recheck central eligibility before activation (if unavailable, defer installation without preventing offline authoring). If save-flush fails, cancel/defer application and leave the app open. Interrupted staging/install preserves the last usable app and the library. Verify these behaviors on a *packaged* N→N+1 transition.
- Update eligibility always advances to the newest safe published **macOS** version, including minor releases. Blocked versions are not offered, including after manually reinstalling an older DMG. There is no automatic downgrade/rollback.

### Arch-compatible Linux — x86-64

- Publish one versioned **prebuilt native Arch-compatible executable package archive** on GitHub Releases, and a standard AUR **`elef-bin`** PKGBUILD downloading that exact immutable artifact with a verified SHA-256. If `elef-bin` is occupied by an unrelated package at registration, use `elef-desktop-bin` and document the name; do not overwrite another maintainer's package.
- Build in an Arch Linux environment (for example, an official Arch container/job on a hosted runner), using pinned build inputs where practical. In CI, create a local test archive before the first release; validate `makepkg` as an unprivileged user using a local served artifact, inspect ELF/linked libraries (`readelf`/`ldd` and Arch package ownership), install under a clean Arch test root, launch under a virtual display/D-Bus, exercise a smoke scenario, upgrade and uninstall. Verify declared `depends`, desktop entry, icon and paths.
- AUR publishing automatically updates `pkgver`, `pkgrel`, source checksum and `.SRCINFO` **after the corresponding immutable GitHub asset is visible and validated**. Initial AUR account/SSH setup is a one-time human prerequisite, not a recurrent release step. No Omarchy-specific package logic.
- Linux has **no in-app self-installer**. The OS package manager owns installation and upgrades (`omarchy update` on Omarchy). Build/command tests assert it cannot modify package-managed files. Initial and periodic updates on a real Omarchy computer are acceptance rehearsals, **not** a per-merge publishing gate. Do not run a persistent GitHub Actions runner on the user's personal Linux machine.
- The existing Ubuntu AppImage job may remain for internal experiments, but **do not publish or advertise an AppImage as a supported v0.x artifact**, include it in updater manifests, or use it as the AUR binary.

## 4. Merge-to-release automation

**Owner approval is the only routine human release decision.** Agents submit PRs (normally from `dev` or a feature branch into `main`); the owner reviews and approves promotion into protected `main`. Every required repository test, including experimental-feature tests and both desktop profiles, must pass. No agent auto-merge. After merge, revalidate the **exact merged source SHA**; current CI jobs skipped on `push` must be made available to the post-merge gate rather than assuming a PR SHA is equivalent.

**Unit of release:** one approved PR merge to `main` (identified by PR and resulting `main` SHA, not each individual commit inside a rebased PR). Each gate-passing merge is automatically processed; failed gates are recorded as `failed_gate`, the owner is notified, no artifact becomes eligible, and repair is via a new approved PR. Do not rewrite `main` to cover a failed release.

**Single minimal mutable release state:** use a dedicated `gh-pages` branch in the Elef repository. Store `desktop/stable/state.json` as the authoritative serialized ledger and generate `desktop/stable/latest.json` from it **in the same branch commit**. Serve the latter via GitHub Pages at the stable project URL `https://hansespinosa2.github.io/elef/desktop/stable/latest.json` after verifying/enabling Pages once. The Tauri release config uses that HTTPS URL. This is the only mutable central release record; GitHub version tags, published GitHub Release artifacts and per-version checksums remain immutable. If Pages hosting/permission is unavailable, record `BLOCKED_EXTERNAL` and **do not advertise automatic updating as complete**; do not invent an unapproved hosting service.

Ledger minimum fields per release: `{version, tag, main_sha, pr, gate, macos, linux_asset, aur, blocked, reason, created_at}` with each platform in `pending | passed | failed | superseded` (or equivalent documented state). Also record `last_reconciled_main`, current minor milestone, and any reserved versions. Only a trusted, serialized publishing workflow may mutate the ledger; protect the branch, use least-privilege tokens, and retry compare-and-swap/fast-forward push failures. **The Pages manifest is derived, never an independent manually edited source of truth.**

**Deterministic version and retry rules**

1. Start with `desktop-v0.1.0` if unused. For each next gate-passing release reservation allocate the next unused patch in the current explicitly selected minor series. Minor milestone changes are made by a manually authorized control action, not inferred from labels. A tag/version is never reassigned to another commit. A fully failed unpublished reservation may leave a **numbering gap**; published versions always advance. A release is *published* when the first verified platform distribution is public, not only when both succeed.
2. The reconciler processes approved `main` merges in their actual merge order, using the ledger and GitHub PR/commit records. Run on merge/push and periodically/on demand to repair missed events. Use `concurrency: { group: ..., cancel-in-progress: false, queue: max }` where supported; do **not** assume queue order equals Git history or that 100 queued runs never overflow. Ledger reconciliation is authoritative, idempotent and covers runs lost from queues.
3. One Git tag and **one GitHub Release per version**. Create as draft. Upload verified macOS and Linux assets idempotently; make the release public as soon as **one** platform is validated and distributed, clearly displaying `Complete` or `Partial — macOS/AUR pending` plus the source SHA. AUR has its own status. Never overwrite an existing binary, signature or tag; a retry may only resume the original version/commit with the original verified artifact.
4. Platform publication can succeed independently **after shared gate success**. Only a validated macOS artifact from a public, unblocked release may be offered by the safe manifest. Only a validated Linux artifact from a public, unblocked release may be put into the AUR. A failed platform must not hold up the successful one.
5. On recovery, a lagging platform may publish the **newest safe, validated** build directly; older pending platform publications are marked `superseded`, with older immutable archives retained. Never publish an older platform version over a newer one. Publication retries must check the ledger again immediately before changes.
6. A release job produces **no commits to `main`** and does not rely on a tag pushed by `GITHUB_TOKEN` to trigger another release workflow. Test state transitions for two rapid merges, duplicate events, retries, partial successes, superseding, and minor changes.

**Secrets and controls:** AUR SSH credentials and Tauri private signing keys live in secured GitHub Actions environments/secrets; untrusted PR jobs never receive them. Human authorization is required for initial account setup, deliberate minor milestones, and an emergency block/unblock—not for routine publication. Per-platform failures notify the owner and are visible in Actions and GitHub release notes.

## 5. Central release blocking, recovery and compatibility

- Authorized emergency `workflow_dispatch` marks one or more versions **blocked** in the ledger, records actor/reason, regenerates the safe macOS manifest, stops late AUR publishers, and marks the GitHub release as blocked/unsafe in its notes. **Do not delete historical artifacts or reuse version numbers.** Reject stale publish writes. Updates from clients already holding a cached manifest/staged payload are not instantly revocable; validate eligibility again before macOS activation and document propagation delays.
- **AUR limitation:** once a bad PKGBUILD/version is in the AUR or cached, a central block cannot erase what clients already fetched, nor reliably downgrade installed packages. Halt automated promotion, add a visible package/release warning, and publish an owner-approved **higher fixed version** as quickly as possible; document manual downgrade instructions. Do not claim guaranteed remote recall of already published AUR packages. Fresh AUR availability is best-effort during propagation.
- Retain all previous versioned DMGs, native Linux archives and PKGBUILD history. Manual rollback is supported on both platforms. On a Mac restored to an older version, the safe feed never offers a blocked version; on Arch, explicitly use package-manager-compatible downgrade instructions and do not let an outdated publishing job republish it.
- Preserve library directory and on-disk file formats through v0.x. No automatic incompatible migration. Read/write compatibility tests include old and new fixtures, unsupported source preservation, and restoration of the pre-v0.1.0 Stable library-root selection.

## 6. Local-only diagnostics

Use one **allowlisted structured event writer** with bounded rotation. Include `timestamp`, Elef `version`/`build SHA`/`profile`, platform/architecture, event code, result, and sanitized error category for startup, save/open failures, render/export failures and update events. Default logs/exports **never include** source text, titles, filenames, user paths, tokens, secrets, arbitrary exception strings or raw IPC payloads. Test hostile sentinel values in all logged input fields and in failure paths (not just ZIP export). No remote telemetry.

Provide a small **Export Diagnostics** command using existing menu/native affordances plus a documented on-disk log location for when the UI fails. ZIP must include actionable event codes and versions while excluding every sentinel value in the privacy fixtures. Do not redesign the editor to surface diagnostics.

## 7. Release gates and evidence

**Gate A — automated, before each eligible publication** (hosted CI; no personal-device involvement):

| Gate | Deterministic evidence / pass condition |
|---|---|
| All required checks | Entire repo suite passes on exact approved merged SHA (including experimental tests, Rails suites, desktop unit/E2E and both builds); none skipped or weakened; release-signing jobs never run untrusted PR code |
| Rails ownership | `app/` imports no `desktop/` code (existing architecture checker); Rails render/JS/System tests pass without test weakening; Rails build/metafile diff reviewed against explicit desktop-profile exception list; no Rails feature/behavior change |
| Stable isolation | Checked-in exclusion inventory agrees with Stable esbuild metafile, UI/navigation/keyboard negative E2E and native command allowlist; no excluded controller/route initialized; each allowed shared dependency justified |
| Authoring & rendering | Fixtures for **document and presentation** complete create → edit → save → close → reopen and exact source round-trip; exercise existing math/shortcuts/directives, preview, present, images, themes, Mermaid/SmartArt, snippets, print/PDF and `.elef` round-trip |
| Storage/offline | Historical and unsupported-source fixtures preserved; deliberate save-conflict and unsaved-close scenarios safe; full core scenario runs with external network denied and no Rails; no real user library referenced |
| App identity | Existing Stable app-data/library-root fixture survives upgrade; Dev and Stable store separate selected roots and do not collide on single-instance/update state |
| Linux native | Arch-hosted build succeeds; `readelf`/`ldd` dependency verification, `makepkg`, install, Xvfb/D-Bus launch, upgrade, uninstall pass; in-app Linux updater disabled |
| macOS native | `macos-15` ARM64 hosted runner installs/launches a packaged DMG and passes a **packaged** N→N+1 staged-download/quit-relaunch/update scenario, including unsafe save, interrupted installation and blocked-version tests |
| Publication logic | Deterministic state-machine tests cover idempotency, queued merges, gap/reservation, partial delivery, newer catch-up, safe-feed update/block, AUR stale retries, invalid signature, and never-downgrade |
| Privacy/secrets | Logs/export contain none of adversarial sentinel values; no secrets in artifacts/build logs or outside allowlisted diagnostic fields; scripts enforce release permission boundaries |

Required fixture set may reuse existing tests, but must explicitly identify a **basic document, basic presentation, rich rendering/media sample, historical file-format sample, unknown-directive sample, pre-release app-state sample, dirty-save/conflict sample, N-1/N package pair, and redaction sentinel fixture**. Record the fixture paths, exact commands, exit statuses and expected invariants in a checked-in test manifest. A build-only test never substitutes for an installed-app check.

**Gate B — initial and periodic physical-device acceptance, not each merge:** Install v0.1.0 on an actual Apple Silicon Mac, document unsigned/ad-hoc Gatekeeper approval, exercise DMG→next-version update and manual rollback; install and update `elef-bin` on actual Omarchy. Repeat after update-mechanism or packaging changes and periodically. Attach observed version, machine type, outcome and sanitized logs to release evidence. A hosted ARM64 Mac runner counts as *real ARM64 CI execution*, but **not** the owner's manual device rehearsal.

**Closed release-blocking conditions:** failed required Gate A checks; missing/invalid platform artifact or signature; incorrect source/version/provenance; missing AUR dependency/install proof; blocked or superseded version; unsafe save/update/identity behavior; release record inconsistency; absent necessary signing/publishing credentials or Pages feed for the affected distribution path. A platform-specific failure blocks **that platform**, not an already validated other platform; failed shared gates block both. External hardware rehearsal gaps are reported, not silently passed and not an ongoing per-merge gate.

## 8. Implementation sequence and agent rules

1. **Reinspect and baseline.** Pin exact `main` SHA and read repository doctrine. Trace desktop/frontend and Rails entry points, current installer/update staging, library-root persistence, CI jobs and test fixtures; verify AUR name and platform dependencies. Inventory in-progress architecture migration or save-system refactors **without importing their scope**. Record current behavior before change.
2. **Desktop-only profiles.** Implement Stable/Dev boundary and small checked-in exclusion inventory; preserve renderer/authoring UX, Rails behavior and Stable identifier. Add profiling/negative tests and Dev state isolation. Avoid broad `app/` refactors or a second renderer.
3. **Release validation first.** Extend existing offline/native/packaged update tests to both profiles and the closed fixture set. Make all required post-merge tests runnable on `main` (several currently run only for PRs). Establish Mac hosted package tests and native Arch container package smoke tests.
4. **Versioned artifacts.** Produce real DMG, signed Mac updater archive and an Arch-compatible x86-64 native archive. Locally test the AUR recipe against a temporary archive before public `0.1.0`; do not publish the old Ubuntu AppImage. Verify macOS ad-hoc signing and boot.
5. **One release coordinator.** Implement serialized/reconciling main-merge workflow, protected GitHub Pages ledger/manifest, unique tags, partial/public releases, independent Mac/AUR publication, retry/supersede, safe-feed and emergency block. Connect AUR publication **after** upstream asset verification and one-time credentials.
6. **Restart update + diagnostics.** Modify existing staged update path for background download/safe restart, preserved files and failure recovery; add bounded local diagnostics and privacy tests. Document Mac/Arch installation, update and rollback.
7. **End-to-end proof.** Owner-approved `main` merges automatically release `0.1.0` then `0.1.1` (or next unused versions); install/upgrade on both platforms; simulate failed AUR publish and safe catch-up, blocked-version emergency action, rollback and state/data preservation. Record Gate B physical-device outcomes separately.

**Parallel work:** Do not modify another agent's in-flight shared files or adopt concurrent `apps/`/`packages/`/`crates/` migrations or save redesigns merely to fulfill this task. If paths moved, use the actual code's responsibilities rather than re-creating stale paths. If a concrete conflict prevents preserving both constraints, label only that item `BLOCKED_DESIGN`, document the code and smallest safe alternatives, continue independent items, and do not claim the blocked capability complete. Use `BLOCKED_EXTERNAL` only for missing account access, secrets, Pages/AUR setup or physical hardware. Never invent test results, releases or URLs.

### Verified baseline pointers (reconfirm in the checkout)

- `.github/workflows/ci.yml`: existing PR/push matrix, Rails and desktop/native/offline E2E, packaged-update fixtures; some full jobs currently have `if: github.event_name != 'push'`.
- `.github/workflows/desktop-release.yml`: current tag-triggered `macos-15` DMG + Ubuntu AppImage, sequential draft publication; must be replaced/extended for main-merge release and Arch AUR.
- `desktop/frontend/build.mjs` and `desktop/frontend/src/main.js`: esbuild desktop entry and alias to Rails-owned `app/javascript`; packages Rails-built renderer. `app/javascript/lib/editor_runtime.js` and `file_library_application.js` are shared dependencies; **inspect, don't globally switch off web features**.
- `desktop/src-tauri/tauri.conf.json`, `desktop/scripts/prepare-updater-config.mjs`: Stable identifier `com.elef.desktop`, existing updater configuration and GitHub-latest URL; preserve identity and generate controlled feed URL.
- `desktop/frontend/src/update-flow.js`, `close-flow.js`, `desktop/src-tauri/src/lib.rs` and `desktop/crates/elef-core/`: existing confirm/install/relaunch path, library-root state and staged-update safety; extend, don't reinvent.
- `test/e2e/scenarios/`, `desktop/e2e/`, existing architecture checks: reuse/extend; do not replace or weaken.

## 9. Definition of done

**DONE** means a protected, owner-approved merge into `main` triggers a zero-routine-manual-step pipeline; complete required Gate A tests pass; immutable tagged builds are released with correctly allocated versions; ARM64 DMG installs and safely self-updates on restart; `elef-bin` installs/updates through Arch package management; releases can be partially completed, retried, superseded and centrally blocked; previous artifacts remain recoverable; desktop experimental code is disabled/excluded by contract while Rails and authoring remain unchanged; offline and data compatibility tests pass; logs are safely exportable; and real release links plus validation evidence are provided.

If GitHub Pages, AUR account/credentials, signing material or actual hardware is unavailable, complete and validate the independent pieces, state **exactly** what is blocked and why, and do **not** label the entire release system DONE.

**Reference:** [repository](https://github.com/Hansespinosa2/elef) · [GitHub Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) · [Tauri updater](https://v2.tauri.app/plugin/updater/) · [Tauri AUR guide](https://v2.tauri.app/distribute/aur/) · [Arch `.SRCINFO`](https://wiki.archlinux.org/title/.SRCINFO)
