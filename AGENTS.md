# Elef Agent Instructions

Elef's v9 target is one product in Rails web and standalone Tauri hosts, with shared behavior implemented once. The migration authority defines that target; durable docs describe the current implementation.

## Start here

For campaign work, read in this order:

1. `AGENTS.md`
2. `docs/refactor/CONSTITUTION.md` — product intent, architecture and campaign rules
3. `docs/refactor/status.json` — current execution state; never overrides criteria
4. the current `docs/refactor/phases/NN-*.md` — phase criteria
5. the frozen phase plan and the actual phase diff, including pending changes

The constitution's authority order governs conflicts. Durable references are [ELEF-DOCTRINE.md](ELEF-DOCTRINE.md), [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md). Current code is evidence of reality.

## Skill routing

- **go**, continue, resume, finish, or run the refactor campaign → `$elef-campaign`.
- New phase or nontrivial architecture/runtime/product change → `$implementation-strategy`.
- Code, build, test, contract or runtime behavior changed → `$code-change-verification`.
- Candidate phase ready for independent verification → `$independent-phase-review`.
- Durable docs or campaign state changed → `$docs-sync`.

Use `.agents/skills/` as the sole workflow source. Setup templates and installation copies have been retired.

Treat installed skills and this router as read-only campaign instructions. A workflow defect needs an evidenced blocker and owner-approved correction; never change the workflow to certify your own work. Phase 12's explicit retirement/repointing is the planned exception.

## Autonomy

Within the authorized campaign, inspect/edit implementation, tests and docs; run checks; repair failures; create safe temporary worktrees; make checkpoint commits; push the campaign branch; open/update its draft PR; and advance verified phases. Routine implementation choices are resolved from repository authority.

User task scope takes precedence: preparing or reviewing the agent system does not itself start product migration. A campaign invocation continues through technical completion or a defined blocker.

## Safety

Never:

- discard unknown changes, commit them as your work, or reset unrelated work;
- force-remove dirty review worktrees or overwrite an existing review bundle;
- weaken criteria/tests/baselines/fixtures or grow allowlists to obtain PASS;
- silently change a frozen contract, or edit production during PLAN;
- invent credentials or commit them to `.env` or history;
- claim unrun or unavailable checks passed;
- merge into `dev`, publish a production release, or perform human release gates;
- stop, restart, re-port or test against the owner's `https://127.0.0.1:3000/` server;
- point tests at personal/live development data;

## Verification

Use canonical `bin/check` through `$code-change-verification`. Until a tier is implemented, use the documented focused commands and keep the missing tier nonzero.

Run `quick` during iteration and `affected` before a coherent behavior/build/contract checkpoint; run phase validation for a committed candidate. Release validation belongs at its required gates.

The default machine is a Linux container of about 8 GB RAM. Probe actual resources, serialize heavyweight work, preserve safe caches, and reduce concurrency after resource kills.

Browser automation is headless. Local real Tauri needs `xvfb-run`, `tauri-driver` and `WebKitWebDriver`; exact-candidate CI evidence may supply native checks when local prerequisites are missing. Human device/signing/deployment gates remain pending. Claim screenshot verification only for inspected images.

## Git and PR

- Campaign branch: `feat/refactor-desktop-and-web`; verify lineage and fast-forward only.
- Commit coherent changes with imperative subjects; no co-author trailers or history rewriting.
- Campaign PR targets `dev`; open as draft if absent using `.github/pull_request_template.md`.
- Push after state-changing checkpoints and before stopping; record any failed push and its recovery action.

## Restart and completion

Resume from repository evidence, including incomplete review rounds and blocker records. A phase completes only with matching machine gate output and exit 0, a fresh reviewer PASS for the same candidate/base, and a committed ACT transition to PASS.

If state disagrees with evidence, reconstruct the earliest unproven phase. Preserve review-round counts within a phase. Continue automatically after PASS; Phase 12 ends the technical campaign and may retain only the constitution's named human release gates.
