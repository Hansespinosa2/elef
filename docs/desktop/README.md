# Elef Desktop — Architecture Docs

Revision v3 · 2026-10-01 · Decider: Andres

The elicited preferences list (batch-elicit-me, 4 batches) is the brief; these docs are the blueprint. Suggested home in the Elef repo: `docs/desktop/`, so every executor prompt and agent reads them next to the code.

## Reading order

| # | Doc | Answers |
|---|---|---|
| 1 | [requirements.md](requirements.md) | What "good" means here: goals, non-goals, constraints, ranked quality goals, testable quality scenarios, budgets, v1 acceptance |
| 2 | [architecture.md](architecture.md) | How the system is shaped: context, strategy, building blocks, runtime flows, distribution, cross-cutting rules, glossary |
| 3 | Seam specs: [data-format.md](data-format.md) · [transport-adapter.md](transport-adapter.md) · [security.md](security.md) · [test-strategy.md](test-strategy.md) | The only places web/desktop divergence or user data loss can enter. Seams get specs; internals don't |
| 4 | [adr/](adr/README.md) | Why each load-bearing decision was made. Read before re-litigating |
| 5 | [delivery-plan.md](delivery-plan.md) | Scope, flag register, milestones, spikes, human gates |
| 6 | [risks-and-open-questions.md](risks-and-open-questions.md) | Risk register, accepted debt, and the remaining human decisions |

## Decision status

| ADR | Decision | Status | Accepted when |
|---|---|---|---|
| 001 | Folders on disk are the source of truth | Accepted | — |
| 002 | Tauri shell | Proposed | S2 + S3 + S4 pass |
| 003 | File-backed Rust backend, no bundled Rails | Proposed | S1 passes |
| 004 | Editor JS reuse via transport adapter | Proposed | 002 + 003 accepted; S1 completes the adapter spec |
| 005 | Defer revisions and lineage behind flags | Accepted | — |
| 006 | Layered, assume-breach security model | Proposed | S5 passes; hostile fixtures green in CI |
| 007 | One shared JS renderer | Proposed | S1 renderer items pass |
| 008 | Atomic writes, fingerprint checks, conflict UI | Accepted | — |
| 009 | Distribution, signed updates, key custody | Proposed | S3 + S4 pass; key custody performed |

Proposed ADRs are accepted on spike results, not on a nod (see Q10 if you want an additional sign-off).

## Documentation rules

1. **One home per fact.** Link instead of restating. The renderer decision used to be restated in nine places, which is how ADR-003 went stale; it now lives in ADR-007 alone.
2. **Docs describe the current state.** History lives in git and in ADR status and supersession, not in "correction" callouts.
3. **ADR lifecycle:** Proposed → Accepted → Superseded/Deprecated. Accepted ADRs are immutable except status and dated amendments ([adr/README.md](adr/README.md)).
4. **Every requirement is testable.** Quality scenarios carry a measure and a verifying tier; adjectives like "fast" or "secure" don't count.
5. **Open questions get IDs** and live in one file.
6. **Docs change in the same PR as the code they describe.** It is part of every milestone's definition of done.
7. **Diagrams are Mermaid** (tool-agnostic, diffable).

## For coding-agent handoff

Point the agent at `architecture.md` + the relevant ADR(s) + the seam spec for the milestone (see [delivery-plan.md](delivery-plan.md) §6). That is the full context it needs. `requirements.md` is the acceptance bar.

## Old → new map

| v2 file | Now |
|---|---|
| `architecture.md` | `architecture.md` (restructured; goals and budgets moved to `requirements.md`) |
| `v1-scope.md` | `delivery-plan.md` (scope, milestones) and `requirements.md` §9 (acceptance) |
| `spikes.md` | `delivery-plan.md` §4 (S1–S5) |
| `adr/006-security-model.md` | Decision stays in ADR-006; threat model and controls moved to `security.md` |
| `adr/003-…` renderer text | Removed; owned by ADR-007 |
| ADR-001/002/004/005/007 | Same names, revised to the standard template |
| `data-format.md`, `transport-adapter.md`, `test-strategy.md` | Same names, revised |
| — | New: `requirements.md`, `security.md`, `risks-and-open-questions.md`, `adr/008`, `adr/009`, `adr/README.md` |

## What changed in v3

Review criteria: ISO/IEC 25010:2023 quality characteristics (as a completeness checklist), SEI quality-attribute scenarios (to make requirements testable), the arc42 section structure, and ADR best practice (one decision per record, immutable once accepted, confidence and revisit triggers recorded).

**Contradictions fixed**
1. ADR-002/003 said "needs Andres's nod" while the README said "accepted on spike results" → one rule, per-ADR "Accepted when" evidence.
2. ADR-001 said last-write-wins while architecture said never → ADR-008; ADR-001 annotated.
3. ADR-003 still carried the superseded renderer plan → cleaned; ADR-007 owns the renderer.
4. "Only network traffic is the update check" vs per-deck remote-image opt-in and bug reports → stated precisely; remote images blocked in v1 because a static CSP cannot express a per-deck opt-in (Q5).
5. Architecture flow "update cache" while the cache is deferred → removed.
6. `save_source` had no hash for conflict detection → the adapter owns a `base_hash` handshake.
7. Renderer described as "no DOM" while including Mermaid → renderer emits placeholders; Mermaid runs in the webview.
8. `render_preview` listed as a Rust command although it runs JS → webview-local handler (S1 confirms).
9. "Round-trips byte-identical" was undefined → defined as per-file SHA-256 equality.
10. M3 tied desktop schedule to a production web cutover → split into M3 and M3w (Q9).

**Gaps filled**
Requirements and quality scenarios with measures; ISO 25010 coverage table; risk register; ADR-008 (safe writes) and ADR-009 (distribution and key custody) for decisions that had no record; spike S5 (hostile-deck IPC probe); security threats T6–T9 (DoS, update channel, supply chain, tampering); storage for snippets and math shortcuts; library-shell commands; per-command capability review; device-local vs portable state; Unicode normalization; unwritable-folder handling; `.elef` layout and determinism; diagnostics; flag register with removal conditions; architecture fitness checks in CI; MiniRacer threading, fork, memory, and platform feasibility.
