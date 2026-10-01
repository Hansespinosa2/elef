# Elef Desktop — Requirements and Quality Goals

Status: draft v3 (2026-10-01). This is the acceptance bar for v1. [architecture.md](architecture.md) explains how it is met; [delivery-plan.md](delivery-plan.md) says when.

Conventions: quality vocabulary follows ISO/IEC 25010:2023 (nine product-quality characteristics). Scenarios use the SEI six-part form (source, stimulus, environment, artifact, response, response measure), condensed into the columns below. Every scenario names the test tier that verifies it ([test-strategy.md](test-strategy.md)). A requirement without a measure does not belong here.

## 1. Purpose

A bundled, offline-first desktop app for macOS (Apple Silicon) and Linux (Arch/Omarchy) for writing notes and presentations in Elef. Obsidian / VS Code family: a native-feeling app over plain folders. Not a thin web wrapper, not a PWA.

## 2. Stakeholders

| Stakeholder | Interest |
|---|---|
| Andres — owner, primary user, two devices (MacBook Air, Omarchy) | Owns his data; identical editing experience; usable v1 soon |
| Web app users | The renderer cutover (ADR-007) changes the production web rendering path; it must not regress |
| Coding agents | Execute from these docs; seams must be unambiguous, nothing may be "guessed" |
| Authors of decks Andres opens | Not a stakeholder but a threat source: their decks are untrusted input ([security.md](security.md)) |

## 3. Goals and non-goals (v1)

Goals
1. Folders on disk are the source of truth; no database server; any cache is rebuildable.
2. The editing experience (visual editor, source editor, flow) and core workspace views (all work, documents, presentations, document graph) behave the same as web; window chrome and file-backed actions may differ.
3. One shared JS renderer, written once, used by Rails and desktop (ADR-007).
4. Offline-first; auto-update from day one.
5. Usable soon: revisions and lineage graph are deferred behind flags (ADR-005).
6. One suite of user-flow scenarios, run on web and desktop, tiered for speed.
7. Opening an untrusted deck or `.elef` file is safe.

Non-goals (v1)
Cross-device sync, Windows, revisions UI, lineage graph, SQLite cache, PPTX export, a custom slide-to-PDF exporter (the File → Print action opens the OS print dialog for the rendered preview), deep OS integration beyond `.elef`, a network bug-report endpoint, new accessibility or i18n commitments beyond what the shared editor JS already provides.

## 4. Constraints

| Kind | Constraint |
|---|---|
| Platform | macOS Apple Silicon and Linux (Arch/Omarchy). System webviews: WKWebView on macOS, WebKitGTK on Linux |
| Existing system | Web app is Rails 8 + Hotwire (Stimulus, CodeMirror 6, importmap), Postgres. It keeps running unchanged except the renderer path |
| Cost | No Apple Developer ID ($99/yr) in v1 — rules out update mechanisms that require it (ADR-002, ADR-009) |
| Organization | Solo maintainer plus coding agents. Executor prompts target `origin/dev`, reproduce-first, green CI, PR left unmerged unless asked |
| Process | Feature flags, never long-lived branches |

## 5. Quality goals (ranked)

| # | Goal | ISO 25010 characteristic | Why it ranks here |
|---|---|---|---|
| 1 | Editing parity with web | Functional suitability, Interaction capability | Stated as the most important preference |
| 2 | Data safety — never lose or corrupt user bytes | Reliability | Release gate; the product is files the user owns |
| 3 | Security against untrusted decks and archives | Security | Release gate; the desktop webview has IPC to a file-writing backend |
| 4 | No web/desktop divergence (one renderer, one suite) | Maintainability | "Rewrite over maintaining two systems" |
| 5 | Performance within budgets | Performance efficiency | Usable-feel; measured, not assumed |

Ranking is proposed from the preferences list; confirm in [Q1](risks-and-open-questions.md#open-questions). Goals 2 and 3 are gates: failing either blocks release regardless of schedule.

## 6. ISO 25010 coverage check

The standard's characteristics are used here as a completeness checklist.

| Characteristic | Treatment |
|---|---|
| Functional suitability | QS-1 |
| Performance efficiency | QS-6 and budgets (§8) |
| Compatibility | QS-10 (other editors, sync tools) |
| Interaction capability | QS-1; accessibility inherited from shared editor JS, no new commitments (Q8) |
| Reliability | QS-2, QS-3, QS-8, QS-12 |
| Security | QS-4, QS-5 |
| Maintainability | QS-7, QS-11 (analysability) |
| Flexibility | QS-9 (macOS + Linux, case and Unicode semantics) |
| Safety | No physical-harm surface; data-loss harm is covered by QS-2 and QS-3 |

## 7. Quality scenarios

| ID | Stimulus and environment | Required response | Response measure | Verified by |
|---|---|---|---|---|
| QS-1 | User performs a named flow (open deck, type, auto-save, undo/redo, insert image, toggle source/visual, snippet insert, math input) on web or desktop | Same observable behavior on both | Shared scenario specs pass on both runners; a flow in only one runner needs a documented reason | T1, T2 |
| QS-2 | App process is killed or power is lost at any point during a save | Source file holds entirely the old or entirely the new content | 0 corrupted or truncated files across the fault-injection matrix (4 kill points × ≥50 runs each) | T3 |
| QS-3 | Another program changes the source file while the deck is open, with or without unsaved edits | Change detected before the next write; unsaved edits raise the conflict UI; otherwise a silent reload | 0 silent overwrites across tested interleavings; CI measures final hash-check-to-rename p95 below 250 ms. A write in that last synchronous filesystem window remains a documented residual race | T0 (Rust), T2 |
| QS-4 | User opens a hostile deck: script payloads, `javascript:` links, remote images, traversal paths | Neutralized: no script runs, no IPC call, no read/write outside the library root, no network request | 0 successes across the hostile corpus; CSP asserted in CI | T0, T3 |
| QS-5 | User imports a hostile `.elef`: zip-slip, symlink entries, absolute paths, zip-bomb | Rejected before any write outside the temp dir; limits enforced (500 MB uncompressed, 10k entries, ratio flag) | Every fixture rejected with a typed error; 0 files written outside temp/library | T0, T3 |
| QS-6 | User performs the operations in §8 on the target hardware | Within budget | p95 under budget over ≥20 release-build runs | T2 perf leg |
| QS-7 | A renderer bug is fixed | Fixed once; web and desktop both receive it | After cutover: CI fitness checks pass — Ruby `Source::HtmlRenderer` absent; Rails and desktop load a bundle with the same hash | CI fitness |
| QS-8 | An update is corrupt, badly signed, or interrupted mid-install | Old version remains runnable; user data untouched | N-1 → N succeeds; three injected failures (bad signature, truncated download, interrupted install) all leave N-1 runnable | T3 |
| QS-9 | Same library used on macOS arm64 and Linux | Identical deck discovery and identity; case-only and Unicode-equivalent name collisions warned | Cross-platform fixture suite green on both OSes | T2, T3 |
| QS-10 | Folder is touched by other editors or sync tools (conflicted copies, partial writes, dot-files) | Deterministic source-file choice; no crash; no clobber | Fixtures: `talk (conflicted copy).md`, multiple `.md`, sync temp files | T0 |
| QS-11 (proposed) | User hits a bug | Local log and "copy diagnostics" exist and exclude deck content | Logs rotate under a size cap; automated check finds no deck text in logs | T0, T3 |
| QS-12 | No network | Every feature except the update check works; updater degrades silently | Full scenario suite passes with the network blocked | T2 |

## 8. Performance budgets

Measured on the MacBook Air unless noted. Protocol: release build, fresh process, p95 over ≥20 runs, against the scale fixtures (1,000 decks; 50 MB deck).

| Operation | Budget |
|---|---|
| Cold start → interactive | < 1.5 s |
| Open a 100-slide deck (includes first render) | < 300 ms |
| Warm library list, 1,000 decks | < 500 ms |
| Autosave | No dropped keystrokes or input, ever (automated typing burst during save) |

Linux (WebKitGTK) is measured separately in M5 against the same numbers. A miss is recorded as a named gap (ADR-004 trigger), never silently waived.

## 9. v1 acceptance — done when all hold

1. QS-1 passes on both runners.
2. QS-7 holds and the renderer fixture suite is 100% (normalized before cutover, exact after).
3. QS-2, QS-3, QS-5 hold: no test or fault-injection run ever loses user bytes.
4. QS-8 holds: the update cycle and the failed-update fallback are tested, not hoped for.
5. §8 budgets met.
6. QS-4 holds in CI.
7. Human gate: a week of real work on both devices with no data loss.
