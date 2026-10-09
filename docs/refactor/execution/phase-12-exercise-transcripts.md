# Phase 12 DO-5 exercise transcripts (P12-07)

Protocol: all five exercises solved by one fresh read-only subagent
(01a122df-452f-7a80-9ddd-825bf3d540f3) given the seed task parts only. The
solver located the "## Expected answer" boundaries first and read only
lines 1–19 of each seed; its full tool history (audited from the session
log) shows durable docs + seeds only — no constitution, no AGENTS.md, no
skills, no expected answers, no suite execution. Wall-clock per exercise
from the solver's own timestamps; the criterion allows ≤300 s each. Full
solver session retained under the campaign session's `subagent/` logs.

## EX-4 new Work syntax (":::poll"): PASS (~4 s)

- Seed: `docs/refactor/execution/phase-12-exercises/ex4-new-syntax.md`.
- Solver (22:53:56→22:54:00): owners `packages/work-model` (semantics),
  `packages/renderer` (projection), `packages/client` feature slice
  (voting UI); shared; proof `npm test --prefix packages/work-model`,
  `npm run renderer:build` + `npm run test:javascript`, `npm test
  --prefix packages/client`, desktop build, ownership check, then
  `bin/check affected` (`all` for full parity).
- Verdict: PASS. Owner, shared/host call, and proof commands match the
  expected answer; the extra handoff commands are all valid.

## EX-5 native capability ("dock badge dot"): PASS (~2 s)

- Seed: `docs/refactor/execution/phase-12-exercises/ex5-native-capability.md`.
- Solver (22:54:00→22:54:02): owners `apps/desktop/frontend/src` adapter
  + capability-declared Tauri command, dirty state read from
  `WorkSession`; host-specific (desktop-only); proof frontend suite,
  client suite, frontend build, arch checker, fmt/clippy, then
  `bin/check affected`.
- Verdict: PASS. Matches the expected answer exactly.

## EX-6 web-only page ("admin word-count dashboard"): PASS (~2 s)

- Seed: `docs/refactor/execution/phase-12-exercises/ex6-web-only-page.md`.
- Solver (22:54:02→22:54:04): owner `apps/web/app/` (+ routes as
  needed), styling from `apps/web/app/assets`; host-specific (web-only);
  proof focused `bin/rails test`, `npm run test:javascript`, focused
  system test, then `bin/check affected`.
- Verdict: PASS. Matches the expected answer exactly.

## EX-7 editor behavior ("word-count status bar"): PASS (~2 s)

- Seed: `docs/refactor/execution/phase-12-exercises/ex7-editor-behavior.md`.
- Solver (22:54:04→22:54:06): owner `packages/client` editor feature
  slice (+ `packages/work-model` counting helper); shared via
  `mountElef`; proof client + work-model suites, desktop build,
  ownership check, e2e parity (`bin/check all` for the full envelope).
- Verdict: PASS. Matches the expected answer exactly.

## EX-8 shared export ("OPML export"): PASS (~2 s)

- Seed: `docs/refactor/execution/phase-12-exercises/ex8-shared-export.md`.
- Solver (22:54:06→22:54:08): owners `packages/client` export UI/engine
  with work-model/renderer outline support, host adapters supply save
  edges; shared engine; proof client + work-model suites,
  renderer build + `test:javascript`, desktop build, ownership check,
  then `bin/check affected` (`all` for full parity).
- Verdict: PASS. Matches the expected answer exactly.

Result: 5/5 PASS, each far under the 300 s budget. No docs gap found;
no reseed needed.
