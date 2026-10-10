# PR #136 integration assessment

**Reviewed:** 2026-10-10, read-only.

**Release branch:** `feat/desktop-release-constitution`, PR [#147](https://github.com/Hansespinosa2/elef/pull/147), targeting `main`.
**Refactor branch:** [#136](https://github.com/Hansespinosa2/elef/pull/136), `feat/refactor-desktop-and-web`, targeting `dev`.

## Recommendation

Do not rebase or merge #147 onto #136 now. Keep the release PR based on `main` and open for owner review. #136 is a draft with a dirty merge state, an unfinished final phase, and unresolved conflicts with the release contract. Continue only release work that does not duplicate or conflict with the active host/package moves. When #136 passes its own gates and its conflicts with this constitution have an explicit resolution, integrate by porting/reconciling the release work against the approved refactor result and rerun the combined release gate.

Do not use the unmerged `dev` feature branch as the base of a `main`-targeted release PR. If product sequencing changes to `dev` first, decide that as an owner-approved target change and defer stable publication until the approved code reaches `main`.

## Branch state and size

At review time, #136 was open and draft, with `mergeable=false` / `mergeable_state=dirty`, no review decision, base SHA `26d6ad247e5b55dfa63589d16af9a8f250f2c51c`, and head SHA `509043579cc3f33b716241756f984504816977d9`. Current `dev` was at `769cc79028813d0d4fd0651952739d9008626847`; the shared base was 130 commits behind current `dev`, while #136 had 306 commits beyond that base. Its latest commit reports eight known S1-skew failures.

The PR changes 1,030 files (about 53.7k additions and 12.1k deletions). Its main areas are the Rails host rehome under `apps/web`, Tauri host under `apps/desktop`, shared `packages/*`, the Rust `crates/local-store` split, and the refactor campaign itself. The phase ledger says phases 0–11 are complete, but phase 12 remains `DO`; its next action is serial integration of six workstreams, followed by two full check passes and a fresh review.

Of #147's 179 changed paths, 61 overlap with paths #136 changes or relocates. A read-only `git merge-tree` preview against the current release head emitted 169 conflict entries: 34 content, 14 modify/delete, and 121 file-location conflicts. This is a conflict preview, not an attempted rebase or a prediction that each entry requires a manual resolution.

## What the refactor changes and release impact

| Refactor area | Release work affected | Required handling |
|---|---|---|
| Rails and desktop host rehome | CI, desktop build/configuration, frontend/native files, E2E paths, scripts and fixtures | Port release workflows and tests to the new paths; compare rename-aware diffs before applying patches. |
| Shared code moves into `packages/client`, `packages/work-model`, `packages/renderer`, and `packages/contracts` | Rails ownership checks, Stable bundle metafile inventory, renderer fixtures, build scripts | Re-prove the one-way host dependency and Rails feature parity. Re-establish the Stable/Dev profile boundary in the desktop-specific entry/build. #136's current desktop entry has one output and its client barrel exports experimental capabilities. |
| Rust local-store split | Library-root state, save/open, diagnostics, updater staging and recovery | Reconcile native release behavior with the new crate boundaries; do not drop identity, safe-quit, diagnostics, or recovery guarantees during the split. |
| Quiet-save/snapshot work in Phase 02 | Existing save/close behavior and preservation of unsaved edits | The phase contract removes the ordinary Save indicator and leave warning and adds timed saves, snapshots, and merge behavior. This conflicts with the release constitution's preserve-save/close requirement and explicit exclusion of an autosave/snapshot redesign. Preserve existing behavior or obtain an explicit owner-approved contract resolution before adopting this work. |
| Broader shared-UI ownership model | Rails `app/` ownership invariant | The refactor moves shared owners into `packages/*`; this differs from the release constitution's statement that Rails `app/` owns shared UI/rendering. Do not silently treat the two ownership models as equivalent. Resolve against the binding architecture requirements before integration. |

The PR has architectural coherence and substantial completed work, but that does not establish release compatibility. At review time its visible checks were PR-hygiene `description` and `normalize`; product CI was not demonstrated on the exact head. Its phase ledger itself identifies unfinished integration and known failures.

## Answers to the sequencing questions

1. **Rebase #147 onto #136?** No. They diverged from an old `dev` base; #136 is dirty against current `dev`, and the overlap includes workflow, host, renderer, tests, and native files. Rebasing now would entangle a main-targeted release with an unfinished refactor campaign.
2. **Continue release work or wait?** Keep #147 open against `main`. Its exact head `cad2f9a347be2d898c80ac8ca89fcd6bf06f1745` has a successful 12-job Gate A run plus attestation (`38056552438`); the PR is open and mergeable. Keep avoiding changes in paths actively being moved by #136 until integration. Do not merge; owner approval is required.
3. **Is #136 ready to incorporate?** No. It is still draft, dirty, at Phase 12 `DO`, behind current `dev`, and reports known failures. Its save behavior and shared-code ownership changes also conflict with this release's binding requirements.

## Integration entry criteria

Before integrating #136 with release work:

- Phase 12 is marked pass; the branch is reconciled with the then-current `dev`, and the repeated full checks and fresh independent review pass on the exact candidate SHA.
- Owner resolves the save/close and shared-ownership conflicts without silently weakening the release constitution. If the refactor is changed to preserve those requirements, verify that on its candidate SHA.
- Owner chooses the promotion sequence. For a `main`-targeted release, first promote the approved refactor through the protected-main process, then port/rebase release changes onto that resulting `main` SHA. For a `dev`-first product path, explicitly retarget/defer the release and keep Stable publication gated on promotion to `main`.
- Re-run the combined exact-SHA Gate A: all repository checks, both profiles, Rails behavior/ownership, fixtures and unsupported-source round trips, app identity/storage, offline operation, Arch packaging, and packaged macOS update/install paths. Separate PR results do not prove the combined tree.
