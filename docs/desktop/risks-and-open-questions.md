# Elef Desktop — Risks, Technical Debt, and Open Questions

Status: draft v3 (2026-10-01). One file for what we know we don't know. Other docs reference these IDs (Q1, R4, …); when an item is resolved, move its outcome into the owning doc or ADR and delete it here.

## Risk register

L = likelihood, I = impact (H / M / L).

| ID | Risk | L | I | Mitigation | Owner doc / trigger |
|---|---|---|---|---|---|
| R1 | WebKitGTK (Linux) or WKWebView differ from Chromium enough to break editing parity or perf | M | H | Budgets measured on real targets; T2 on Linux hardware; a named gap triggers the ADR-004 rewrite rule or an ADR-002 revisit | ADR-002, test-strategy |
| R2 | mini_racer/libv8 painful to install on a supported target, fork-unsafe under Puma, or too slow | M | M | Omarchy and basic thread/fork probes pass; macOS-arm64 CI, production Puma behavior and 100-slide latency remain to be measured; Node sidecar is the fallback | ADR-007, S1 |
| R3 | Renderer cutover regresses the production web app | M | H | 100% fixture gate; `ELEF_RENDERER` flag for instant rollback; soak before deleting Ruby | ADR-007, M3w |
| R4 | Updater private key lost or compromised: loss strands installed copies; compromise allows malicious updates | L | H | Two offline encrypted backups; rotation procedure in ADR-009; releases from CI only | ADR-009 |
| R5 | Auto-save with session-only undo: an accidental mass delete followed by close is unrecoverable | M | M | Decision needed (Q2): rolling last-closed snapshot under `.elef/` honoring ADR-005's no-clutter rule | ADR-005, ADR-008 |
| R6 | Hostile content reaches IPC (iframe/IPC class of Tauri issues, sanitizer bypass) | L | H | C1 + C2 + C8 layered; S5 probe on both OSes; pinned Tauri with advisory tracking | security.md |
| R7 | macOS desktop E2E coverage is thin (no official driver) | H | M | Embedded driver, mock tier, manual MacBook check; recorded as an accepted limitation | test-strategy |
| R8 | Unsigned macOS install friction or an OS change blocks first-run or updates | M | M | S3 documents the flow on current macOS; v1 audience is the owner's own devices; revisit before wider distribution | ADR-009 |
| R9 | Cross-platform filesystem semantics (case, Unicode, sync-tool partial writes) corrupt identity or lose edits | M | H | Normalized comparison, source-file rule, atomic writes, fingerprint check, fixtures | data-format, ADR-008 |
| R10 | Solo maintainer: scope creep or a stalled spike delays v1 | M | M | Scope contract in delivery-plan; stretch items have explicit cut points; spikes are time-boxed | delivery-plan |
| R11 | Tauri 2 plugin churn or a security advisory forces an upgrade mid-milestone | M | M | Pin versions; audit in CI; upgrade is a scheduled task, not an emergency | security.md C12 |
| R12 | Feature flags outlive their purpose and become permanent divergence | M | M | Flag register with removal conditions; CI checks live flags | delivery-plan |
| R13 | The pinned Tauri Linux stack pulls transitive crates with current RustSec advisories | M | M | Dated exception (2026-10-01) for RUSTSEC-2025-0057 (`fxhash`), RUSTSEC-2024-0370 (`proc-macro-error`), RUSTSEC-2024-0429 (`glib`), and RUSTSEC-2026-0097 (`rand`). The first and last arrive through Tauri's HTML selector stack; the middle two arrive through GTK 0.18 used by WebKitGTK. Cargo audit fails on any other warning. Revisit at the next Tauri/GTK dependency upgrade | security.md C12 |

## Technical debt (known, accepted)

- Library chrome (deck list, open/import/export) is new and minimal; it converges with the web library after v1 (ADR-004).
- The SQLite cache is deferred; direct folder scans are the v1 strategy (re-evaluate at ~1,000 decks if budgets slip).
- Normalized fixture comparison is temporary scaffolding retired at cutover (test-strategy §3).
- Revisions and lineage are flagged off; the web app keeps them, so a second code path exists until the flags are removed.

## Open questions

Each needs a decision from Andres. "Proposed" is the default the docs currently assume.

| ID | Question | Proposed default | Affects |
|---|---|---|---|
| Q1 | Is the quality-goal ranking right (parity, data safety, security, no divergence, performance)? | As written in requirements §5 | requirements |
| Q2 | Safety net for auto-save plus session-only undo, and what "delete deck" means | Delete = move to OS trash. Safety net: a single rolling last-closed snapshot in `.elef/`, outside deck folders (consistent with ADR-005); skip if you prefer pure Obsidian behavior | R5, ADR-005 |
| Q4 | Split portable library prefs (`.elef/config.json`) from device-local state (app-data directory)? | Yes, split | data-format, architecture §5 |
| Q5 | Remote images in decks | Blocked in v1 (static CSP cannot express a per-deck opt-in); revisit with a Rust fetch proxy if needed | ADR-006, security.md |
| Q6 | Diagnostics and bug reports | Local logs + "Copy diagnostics", no telemetry; network bug reports stay a stretch needing an explicit opt-in policy | architecture §6, QS-11 |
| Q8 | Accessibility and i18n scope for v1 | Inherit whatever the shared editor JS provides; no new commitments | requirements §6 |
| Q9 | Does the desktop release wait for the Ruby renderer's deletion (M3w), and how long is the soak? | Release needs the flag flipped and a soak (suggest ≥1 week); deletion may follow in the next minor | delivery-plan M3w, v1 acceptance |
| Q10 | Spike acceptance: spike results alone (README v2, ADR-007) or results plus an explicit owner sign-off (ADR-002/003 v1 text)? | Results alone, with the spike report recorded in the ADR | adr/README |
