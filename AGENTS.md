# Elef Agent Instructions

Elef is one product hosted by Rails web and standalone Tauri desktop. Shared product behavior has one canonical implementation; host-specific behavior stays in host/native adapters.

## Start here

For the active refactor campaign, authority is:

1. `docs/refactor/CONSTITUTION.md`
2. `docs/refactor/status.json`
3. the current `docs/refactor/phases/NN-*.md`
4. the frozen phase plan named by status
5. durable repository docs and code: [ELEF-DOCTRINE.md](ELEF-DOCTRINE.md), [docs/architecture.md](docs/architecture.md), [docs/development.md](docs/development.md)

Do not duplicate architecture or phase rules here.

## Skill routing

- If the user says **go**, continue, resume, finish, or run the refactor campaign: use `$elef-campaign`.
- Before a new campaign phase or nontrivial architecture/runtime/product change: use `$implementation-strategy`.
- After code, build, test, contract, or runtime behavior changes: use `$code-change-verification`.
- Before any campaign phase may be marked PASS: use `$independent-phase-review`.
- When durable docs or campaign state may change: use `$docs-sync`.

Do not invoke every skill for every trivial edit.

## Autonomy

Within campaign scope, agents may autonomously:

- inspect the repository and history;
- edit implementation/tests/docs;
- run deterministic local checks;
- fix failures caused by their work;
- create safe temporary worktrees;
- create checkpoint commits;
- advance between verified phases;
- resume from `docs/refactor/status.json`.

Do not ask for routine implementation decisions already resolved by repository authority.

## Safety and environment prohibitions

Never:

- discard unknown user changes or reset unrelated work;
- weaken criteria, tests, baselines, fixtures, or allowlists to obtain PASS;
- silently alter a frozen phase contract;
- invent credentials or commit them to `.env` or history;
- claim unrun or unavailable tests passed;
- merge the campaign branch into `dev` or perform human-only release gates;
- stop, restart, or re-port the user's running dev server at `https://127.0.0.1:3000/`;
- point test suites at personal or live development data;
- use the retired `scripts/elef-agent` Apple Container/worktree workflow.

## Development and verification

- Use the repository's canonical `bin/check` entry point (or `docs/development.md` commands prior to its completion) via `$code-change-verification`.
- Ordinary edit loop: `quick` then `affected`. Phase/full validation belongs at phase gates.
- Default execution environment is a resource-constrained Linux container (~8 GB RAM). Serialize heavyweight jobs, keep caches, and reduce concurrency under memory pressure.
- Real Linux Tauri runs require headless `xvfb-run` + `tauri-driver` + `WebKitWebDriver`; if unavailable, record the missing prerequisite or rely on CI rather than faking a PASS.
- Browser automation must be headless. Do not claim visual or screenshot verification unless an image was actually inspected.

## Git and PR workflow

- Work on `feat/refactor-desktop-and-web`.
- Commit coherent changes with concise imperative subjects. Never add co-author trailers or rewrite history.
- The campaign PR targets `dev`. Open it as a draft if missing; use `.github/pull_request_template.md` without recording merge status.
- Push the campaign branch after status-changing commits and before stopping.

## Campaign completion

A phase is complete only when its exact machine PASS marker, fresh independent reviewer PASS, and status transition all exist. If status and reality disagree, reconstruct from evidence and resume from the earliest unproven phase. Continue through final technical PASS without asking for confirmation.
