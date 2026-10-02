# Architecture Decision Records

One decision per record. Read the relevant ADR before re-litigating anything.

## Decision log

| ADR | Decision | Status | Confidence | Accepted when |
|---|---|---|---|---|
| [001](001-folders-as-source-of-truth.md) | Folders on disk are the source of truth | Accepted | high | — |
| [002](002-tauri-shell.md) | Tauri as the desktop shell | Proposed | medium | S2 + S3 + S4 pass |
| [003](003-file-backend-no-bundled-rails.md) | File-backed Rust backend; no bundled Rails | Proposed | high | S1 passes |
| [004](004-frontend-reuse-transport-adapter.md) | Reuse editor JS via a transport adapter | Proposed | medium-high | 002 + 003 accepted; S1 completes the adapter spec |
| [005](005-defer-revisions-lineage.md) | Defer revisions and lineage behind flags | Accepted | high | — |
| [006](006-security-model.md) | Layered, assume-breach security model | Accepted | medium | S5 hostile corpus passes on macOS + Linux; hostile fixtures green |
| [007](007-single-shared-js-renderer.md) | One shared JS renderer for Rails and desktop | Proposed | medium | S1 renderer items pass |
| [008](008-safe-writes-and-conflict-detection.md) | Atomic writes, fingerprint checks, conflict UI | Accepted | high | — |
| [009](009-distribution-and-update-channel.md) | GitHub Releases, signed updater artifacts, key custody | Proposed | medium | S3 + S4 pass; key custody performed |

"Accepted when" points at checkable evidence (spikes in [../delivery-plan.md](../delivery-plan.md)). Q10 in [../risks-and-open-questions.md](../risks-and-open-questions.md) asks whether an explicit owner sign-off is also required.

## Rules

1. **One decision per record**, ideally a page. If it grows past two, split it (and split phased decisions into one record per phase).
2. **Status lifecycle:** Proposed → Accepted → Deprecated or Superseded by ADR-NNN.
3. **Accepted records are immutable.** Only status metadata and dated amendment notes change. A changed decision gets a new ADR that links to the old one and says why; the old one becomes "Superseded by ADR-NNN". Proposed records may be edited freely.
4. **Record confidence** (high / medium / low) and a **revisit trigger**. Low confidence is useful information for later reconsideration.
5. **Justify.** A decision without options and consequences cannot be re-evaluated when circumstances change.
6. **ADRs are not design guides.** Detailed specs live in the seam docs; the ADR holds the decision and why.
7. **Keep them pithy and factual.** Link to the owning doc instead of restating it.

## Template

```markdown
# ADR-NNN: Title

- Status: Proposed | Accepted | Deprecated | Superseded by ADR-NNN
- Date:
- Decider:
- Confidence: high | medium | low
- Accepted when: <checkable evidence>   (Proposed only)

## Context
## Options considered
## Decision
## Consequences   (positive, negative, risks)
## Revisit when
```
