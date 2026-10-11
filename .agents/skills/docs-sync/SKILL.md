---
name: docs-sync
description: Use when Elef durable architecture/developer knowledge or an enduring rule/contract/path/command changes. Keeps one source of truth per fact across durable docs, AGENTS.md, skills and code.
---

# Docs sync

Each fact has exactly one home; everything else links to it.

| Knowledge | Single home |
|---|---|
| product principles / owner intent | `ELEF-DOCTRINE.md` |
| boundaries, ownership, contracts, change-routing examples | `docs/architecture.md` |
| setup, validation tiers, feature/bug workflow, commands | `docs/development.md` |
| domain runbooks (desktop, deployment, media/printing) | `docs/desktop/data-format.md` (formats + trust boundary), `docs/desktop/feature-flags.md`, `docs/desktop/adr/`, `docs/mac-mini-deployment.md`, `docs/presentation-media-and-printing.md` |
| `:::step` reveal semantics | `apps/web/test/fixtures/slide-reveals/parity-cases.json` + `slide_reveals` / `presentation_reveals_baseline` / `presentation_navigation` suites (tests are the spec) |
| `:::align` / `:::position` grammar | `packages/work-model/src/slide_position_layout.ts` header + `packages/work-model/test/fixtures/align_grammar.json` (machine-read corpus) |
| `:::art` syntax | `packages/work-model/src/art_source.ts` header; behavior pinned by `art_contract` + the `art_*` suites, not prose |
| contract types and signatures | code in `packages/contracts` (documented by code, not prose) |
| agent routing + safety | `AGENTS.md` (short router) |
| agent workflow | `.agents/skills/*` (no copied architecture truth) |

## When something changes

1. Find the fact's home; edit it there only. Replace any copies elsewhere with a link.
2. When code moves, update paths/commands in durable docs, code and CI references in the same commit — docs must describe reality at every checkpoint.
3. Durable docs describe the current state. If two docs contradict each other, reconcile toward code reality and owner intent, and record the reasoning in the commit message or PR.
4. Check links: `rg -n "docs/refactor" AGENTS.md README.md docs bin/check` must return nothing — the v9 campaign tree was retired; do not reintroduce campaign paths. (The historical note in this skill is the intentional exception.)

Retired with the v9 refactor campaign: `docs/refactor/`, the `elef-campaign` and `independent-phase-review` skills, and the `bin/check phase` gates. Keep only skills that still reduce steady-state work and point them at durable docs.
