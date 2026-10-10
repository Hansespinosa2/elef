# PR #136 integration assessment

**Reviewed:** 2026-10-10, read-only.

**Release branch:** `feat/desktop-release-constitution`, PR [#147](https://github.com/Hansespinosa2/elef/pull/147), currently targeting `main`; owner-directed integration is Dev-first after #136.
**Refactor branch:** [#136](https://github.com/Hansespinosa2/elef/pull/136), `feat/refactor-desktop-and-web`, targeting `dev`.

## Addendum — Dev-first route and live recheck (2026-10-10)

The owner clarified that #147 must wait for #136, then release work should enter `dev` and later reach `main` only in an owner-approved promotion. No merge is authorized now. This supersedes the earlier recommendation to keep #147 main-targeted through integration.

The coordinator is compatible with that route. Its release workflow listens for completed CI on `main`, its CI gate tests the exact main push SHA, and its reconciler records approved PR merges from first-parent `main` history. Therefore the `dev` merge is an integration step; the later `dev`→`main` PR and its resulting main merge SHA are the release unit. `main` currently follows this promotion pattern: head `41d89fa` is PR #145 from `dev`. Use GitHub's merge-commit method for promotion, consistent with #145 and the one-PR/one-main-merge ledger model; do not rebase-merge the promotion because that places its individual commits on first-parent history.

Live read-only recheck found #136 open and draft at head `83d7959b34e4041c7416d5d640eb1c7ef9f720a0`, based on old `dev` SHA `26d6ad247e5b55dfa63589d16af9a8f250f2c51c`. It was `mergeable=false` / `dirty`, about 130 commits behind current `dev` `769cc79028813d0d4fd0651952739d9008626847`, and 307 commits ahead of its base. Its visible checks were only PR-hygiene `description` and `normalize`; product Gate A was not demonstrated on that exact head. A read-only merge preview against current `dev` reported 98 conflict records. A separate combined refactor/release preview reported 172 records. These are preview conflict records, not a claim that each is a manual content conflict; no merge or rebase was attempted.

The current #147 head was `f36294fcda99eb20d2cf2f777ae28dd7f826d580`, still open against `main`. Its checks were still running at the recheck. Do not rewrite or replay its release history now. After #136 is fully reviewed and merged into `dev`, fetch the actual resulting `dev` SHA, redo the merge preview against that exact SHA, merge that `dev` into the #147 integration head, resolve and test the combined tree, then retarget #147 to `dev` (or open a dev-based continuation PR if a base change makes the review unclear). This preserves commit ancestry without replaying the release branch's roughly 156 commits. Recalculate the merge topology and conflict set after #136 lands.

The #136 blockers remain binding: its save/snapshot behavior must preserve the existing save/close contract, and its shared-code move must preserve the constitution's Rails ownership and Stable/Dev isolation requirements or be explicitly resolved by the owner before adoption. After an owner-approved merge of the integrated release work to `dev`, create an owner-reviewed `dev`→`main` promotion PR. Require all Gate A jobs on its exact resulting main SHA; only then may the coordinator reserve or publish a release.

The GitHub App, Actions variables/secrets, branch rulesets, and Pages configuration are repository-level settings, so changing the code PR's base does not require recreating them. The update-only App bypass remains scoped to `gh-pages`; verify the Pages source is still the `gh-pages` root immediately before first publication (the earlier Settings UI showed a feature-branch source, while later API/readback reported `gh-pages`).

## Addendum — refreshed PR state and integration plan (2026-10-10)

This read-only review supersedes the earlier SHA, readiness, and conflict-count snapshots above. The live `refs/pull/136/head` and refreshed PR API agree on #136 head `b3190433ef30bec2c6f989794a92a959a038417c`; #136 is still open and draft, targets `dev`, and reports `mergeable=false` / `dirty`. Current `dev` is `769cc79028813d0d4fd0651952739d9008626847`; `main` is `41d89fa92a34274d1f2c155d7ae560d728c87fca`. The PR's recorded `26d6ad2` base is its old common point with `dev`, not the current `dev` tip. GitHub compare data reports #136 is 310 commits ahead and 130 behind current `dev`; it reports only the `normalize` and `description` checks passing, with no product Gate A evidence. The branch is not ready to merge.

The refreshed comparison also shows `dev` and `main` have diverged: `dev` is 63 commits ahead and `main` is 5 commits behind their `2dc9ba7` common point. At the review snapshot, #147 was open against `main` at `b003f88`; this worktree then pushed `51f1226`, a STATUS-only update, and a live ref check confirmed that as #147's new head. No release code changed in that status commit. The earlier #147 workflow run `38060948532` was still running at the agent's snapshot on `b003f88`; that is not evidence for `51f1226`. Do not infer exact-head validation from it.

The earlier 98/172 conflict previews, 61 overlapping paths, and their `83d7959`/`f36294f` endpoints are historical only. No current overlap count or merge preview has been verified for `b319043` and the latest #147 head. Recalculate after #136 lands, using its resulting `dev` SHA and the then-current #147 branch.

### Recommended sequence

1. Wait for #136 to leave draft, reconcile with then-current `dev`, resolve the save/close and shared-ownership constraints, pass its exact-head product gates, and receive owner approval. The owner merges #136 into `dev`; record the resulting SHA as `D`.
2. Fetch `dev@D` and preview the combined tree. Merge `dev@D` into the release integration branch and resolve conflicts by current code ownership. Use a merge to preserve the existing release history; do not rebase the long release branch. If that merge makes #147's review diff noisy or includes main-only changes that cannot be explained cleanly, create a continuation branch from `D` and open a dev-based PR containing only the release changes.
3. Retarget #147 to `dev` only after reviewing the resulting diff. Run all required Gate A checks on the exact combined PR head, including Rails ownership/parity, Stable/Dev profile behavior, save and source compatibility, native packaging/updater flows, and release-workflow permissions. The owner reviews and merges the release work into `dev`.
4. Open a separate owner-reviewed `dev`→`main` promotion PR and merge it with GitHub's merge-commit method. Run Gate A again against the exact resulting `main` SHA. That approved PR and SHA are the release unit consumed by the coordinator; the merge into `dev` itself does not reserve or publish a release.

### Branches, profiles, and GitHub setup

This sequence does not require #147 to target `main` during feature integration. Stable still builds only from approved code that reaches `main`, while #147 can enter `dev` first. Branches represent integration and promotion stages; the desktop build profile controls which experimental desktop capabilities are present. A common source tree can produce repository Dev with experimental features and Stable with the excluded features removed, while Rails retains its full feature set. The initial choice to target #147 at `main` came from my mistaken reading of “Stable from main” as requiring the feature PR itself to target `main`; it does not.

Changing PR bases does not require reinstalling the GitHub App or recreating repository variables, environment secrets, Pages, or rulesets. Keep release credentials restricted to their protected environments; do not grant them to `dev`. The App token mint and trusted Pages ledger write/readback remain unproven and must be validated before publication.

## Recommendation

Wait for #136. Then integrate #147 once against the refactor as merged into `dev`, using a merge-based operation rather than replaying the release commits. After review and owner approval in `dev`, promote `dev` to `main` with an owner-approved merge-commit PR. Stable publication remains gated on the exact main promotion SHA and full post-merge Gate A.

## Branch state and size

At the initial review snapshot, #136 was open and draft, with `mergeable=false` / `mergeable_state=dirty`, no review decision, base SHA `26d6ad247e5b55dfa63589d16af9a8f250f2c51c`, and head SHA `509043579cc3f33b716241756f984504816977d9`. Current `dev` was at `769cc79028813d0d4fd0651952739d9008626847`; the shared base was 130 commits behind current `dev`, while #136 had 306 commits beyond that base. Its latest commit at that snapshot reported eight known S1-skew failures. The live recheck is recorded in the addendum above.

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

1. **Rebase #147 onto #136?** Do not rebase or integrate now. After #136 lands in `dev`, merge the updated `dev` into the #147 integration head, resolve conflicts, then retarget #147 to `dev`. This retains ancestry and avoids replaying roughly 156 release commits. Recompute the conflict preview against the actual merge SHA.
2. **Continue release work or wait?** Continue only independent release work; wait for #136 before integration. Leave #147 on `main` for now as the owner requested. At the live recheck, #147 head `f36294f` had current checks still running (`38059167814`); the older successful run on `cad2f9a` does not validate the latest code. No merges are authorized now.
3. **Is #136 ready to incorporate?** No. The live recheck still found a draft, dirty PR, with product Gate A not demonstrated on its exact head and 98 conflict records against current `dev`. Its save behavior and shared-code ownership changes still need reconciliation with the binding constitution.

## Integration entry criteria

Before integrating #136 with release work:

- Phase 12 is marked pass; #136 is reconciled with current `dev`, and repeated full checks plus fresh independent review pass on its exact candidate SHA before the owner merges it to `dev`.
- Owner resolves the save/close and shared-ownership conflicts without silently weakening the release constitution. If the refactor is changed to preserve those requirements, verify that on its candidate SHA.
- After #136 lands, merge its resulting `dev` into the #147 integration head, resolve path moves/conflicts, and retarget #147 to `dev` (or create a dev-based continuation PR if a base change obscures review). Run all required checks on the combined tree and obtain owner approval before merging into `dev`.
- After the integrated release is in `dev`, prepare an owner-reviewed `dev`→`main` promotion PR and use a merge commit. Run all 12 required Gate A jobs on the exact resulting main SHA. That promotion PR and SHA are the release unit; no release is eligible from the Dev merge alone.
- Preserve the product profile split in code: shared Rails/web and repository Dev retain experimental behavior, while the desktop Stable build excludes the contracted capabilities. Git branch names do not implement those UI/profile toggles.
