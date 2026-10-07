---
name: docs-sync
description: Use when Elef durable architecture/developer knowledge or refactor campaign state changes, and during final campaign cleanup.
---

# Docs sync

Maintain SSOT boundaries.

- Temporary migration truth belongs under `docs/refactor/`.
- Durable product intent belongs in the durable doctrine.
- Durable architecture/change-routing belongs in `docs/architecture.md`.
- Durable development/verification workflow belongs in `docs/development.md`.
- `AGENTS.md` stays a short router/policy file.
- Skills contain workflow, not copied architecture truth.

Update `docs/refactor/status.json` whenever campaign state changes.

At final cleanup, prove `docs/refactor/` can be deleted without losing knowledge required to maintain Elef. Retain only workflow skills that still reduce steady-state complexity and point them at durable SSOT.
