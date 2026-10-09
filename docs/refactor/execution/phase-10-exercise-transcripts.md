# Phase 10 DO-6 exercise transcripts (P10-04)

Protocol: each exercise spawned as a fresh read-only subagent with the task
text only (expected answers never in the prompt; `docs/refactor/` off-limits).
Wall-clock measured from first solver activity to delivered result; the
criterion allows ≤300 s each. Full solver sessions retained under the
campaign session's `subagent/` logs.

## Attempt 1 — EX-1 shared feature ("duplicate slide"): FAIL (docs gap)

- Solver: fresh subagent, ~81 s active (spawn epoch 1791564143 → completed
  1791564223.6).
- Answer: owner `app/javascript/` (e.g. `slide_overview_controller.js`),
  shared, proof `npm run test:javascript` + handoff checks.
- Verdict: FAIL. The solver followed the durable docs, which still routed
  shared editor behavior to Rails `app/` — but Phases 08–09 moved the editors
  into `packages/client` (the solver itself noted the Stimulus controller is
  "thin wiring to `SlideOverview.duplicate()` in `packages/client`").
- Response per frozen plan risk row: fixed the durable routing docs
  (`docs/architecture.md` code map + ownership statements,
  `docs/desktop/transport-adapter.md` ownership rule,
  `docs/development.md` fast-checks client/work-model rows, plus the
  `local-store` crate path/name corrections), verified the new proof
  commands run green (client 99/0, work-model 51/0, local-store 73/0), and
  reseeded an equivalent unseen shared-feature exercise. This attempt is
  retained as evidence of the gap and its fix.

## Attempt 2 — EX-1b shared feature, reseeded ("move block up/down"): PASS

- Seed: `docs/refactor/execution/phase-10-exercises/ex1b-shared-feature-reseed.md`.
- Solver: fresh subagent, ~24 s active (first activity 1791564465.6 →
  completed 1791564489.2).
- Answer: owner `packages/client` document-editor feature
  (`features/document/document_editor.js`) with the pure block-move
  transform in `packages/work-model`; shared (both hosts mount the same
  client bundle; host-neutral behavior never lives in a host); proof `npm
  test --prefix packages/client`, `npm test --prefix packages/work-model`
  plus the documented handoff checks. All three correct from the fixed
  durable docs.
- Verdict: PASS.

## Attempt 3 — EX-2 web-only bug (PPTX button disable): PASS

- Seed: `docs/refactor/execution/phase-10-exercises/ex2-web-bug.md`.
- Solver: fresh subagent, ~53 s active (first activity 1791564171.4 →
  completed 1791564224.6).
- Answer: owner `app/javascript/controllers/pptx_export_host_controller.js`
  `download()` with mount points and explicit shared-engine exclusion;
  host-specific (web) grounded in the export registry's `hosts: ["web"]`;
  proof `npm run test:javascript` + `bin/rails test
  test/system/pptx_export_test.rb` (+ suite). Also correctly flagged the
  report as likely inaccurate with a concrete DOM proof proposal.
- Verdict: PASS.

## Attempt 4 — EX-3 desktop/local-store bug (trailing-space rename): PASS

- Seed: `docs/refactor/execution/phase-10-exercises/ex3-desktop-bug.md`.
- Solver: fresh subagent, ~57 s active (first activity 1791564226.9 →
  completed 1791564280.5) after ~80 s capacity queue (disclosed; queue time
  not counted against the solver).
- Answer: owner `crates/local-store` (`Library::rename_deck` →
  `validate_deck_name` chain) with thin callers enumerated; host-specific
  (desktop deck-folder persistence vs PostgreSQL); proof `cargo test
  --manifest-path Cargo.toml -p local-store --locked` + fmt/clippy, verbatim
  from the fixed docs. Also correctly analyzed the report as likely
  inaccurate with concrete rename/list proof proposals.
- Verdict: PASS.

## P10-04 disposition

Three seeded unseen exercises — one shared feature (EX-1b), one web-only bug
(EX-2), one desktop/local-store bug (EX-3) — each completed by a fresh agent
in well under 5 minutes with the correct owner and proof commands named from
durable docs. The one failed attempt (EX-1) exposed and fixed a real routing
defect in the durable docs; its evidence is preserved above.
