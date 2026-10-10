# Desktop release operations

## Routine release coordination

`Desktop Release Coordinator` runs whenever the `CI` workflow completes on a `main` push. It proceeds only when both the workflow source SHA and current `main` head match that completed CI SHA, so a newer merge defers work until its own exact-SHA Gate A finishes. When a previously trusted coordinator exists, a failed or cancelled SHA is checked with that tooling and recorded as failed; no release is reserved for it. The run reconciles the full first-parent history. To repair a missed event, the repository owner can dispatch from `main`; the preflight requires the exact workflow SHA and verifies owner authorization and exact Gate A before publishing:

```sh
gh workflow run desktop-release.yml --ref main -f action=reconcile
```

This main-ref repair is available before the first version tag exists. If the Pages ledger has no trusted tooling revision yet, the initial bootstrap still requires a passing exact-SHA Gate A. If that first Gate A fails or is cancelled, the coordinator currently fails closed without immediately recording `failed_gate` or notifying the owner; a later passing merge can reconcile the history. This initial-failure path remains `BLOCKED_DESIGN` until an independently pinned failure-only recorder or immutable bootstrap trust anchor is implemented and reviewed. The remote `main` ruleset must also require approvals and CODEOWNERS review before any bootstrap verifier can be trusted.

Use `minor` only for an explicitly approved next minor series and provide the authorization reason. A PR merge remains the routine release decision; the coordinator does not merge PRs.

For a PR from another author, the latest owner approval must target the final PR head and be submitted before merge. [GitHub does not permit PR authors to approve their own PRs](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews), so for an owner-authored PR the owner's explicit merge is the approval signal; a merge performed by another actor is ineligible. The coordinator verifies this after merge before reserving a version.

The repository-owner CODEOWNERS entries protect the CI workflow, privileged release workflows, trust verifier, and publishing state machine. The `main` ruleset must require at least one approving review and a CODEOWNERS approval for those paths; confirm this before relying on automatic publication. Preserve the owner-authored PR rule by allowing an owner PR-only bypass if GitHub would otherwise prevent the owner from merging their own PR. The coordinator independently checks exact Gate A and owner authorization. The current `main` ruleset has no required reviews, so this external ruleset setting remains a release trust prerequisite until enabled and verified.

The workflow reconciles the actual first-parent `main` history, reruns the exact-SHA gate evidence, and updates `desktop/stable/state.json` and its derived `latest.json` projection in one compare-and-swap commit on `gh-pages`. A reserved version or a successful build is not a public release or an installation result.

## One-time Pages writer setup

The Pages branch accepts ledger updates only from a dedicated `elef-release-state-writer` GitHub App. The App must be installed on the Elef repository only and have repository **Contents: read and write** permission. Do not use the GitHub Actions integration as the branch bypass actor: any same-repository workflow with a write token would otherwise be able to change the ledger. The workflows use a short-lived installation token only for Pages writes; `GITHUB_TOKEN` credentials are not persisted in Pages checkouts. Release writers query the ruleset list and its full record with that scoped App token before distribution and ledger writes, and fail closed unless it is the active repository rule with the App as its sole bypass actor. These reads use the token’s implicit metadata read access; workflow jobs receive no repository administration permission. Branch-rule mutation remains an owner-admin setup action.

After creating and installing the App:

1. Add repository Actions variable `ELEF_RELEASE_STATE_APP_CLIENT_ID` with the App Client ID.
2. Add the same generated App private key as environment secret `ELEF_RELEASE_STATE_APP_PRIVATE_KEY` in `desktop-release-state`, `desktop-release-signing`, and `desktop-aur-publishing`. Keep `desktop-release-signing` and `desktop-aur-publishing` restricted to `main`. `desktop-release-state` must allow the `main` branch and the `desktop-v*` tag pattern because manual reconciliation and emergency controls run from an immutable release tag. Those two state-environment policies were verified through the GitHub API on 2026-10-10. Keep all other release secrets in their existing environments. Never send or commit the key.
3. Give the repository maintainer the numeric App ID. The maintainer sets repository variable `ELEF_RELEASE_STATE_APP_ID`, then from an authenticated repository-admin checkout runs `node desktop/scripts/configure_release_state_ruleset.mjs <APP_ID> --apply`. This creates or updates a separate active rule that matches only `refs/heads/gh-pages`, blocks ordinary updates, and lets only that App bypass the update rule. It leaves the existing deletion and non-fast-forward protection ruleset unchanged, so the App cannot use its bypass to delete or force-push the branch.
4. The maintainer runs `node desktop/scripts/configure_release_state_ruleset.mjs <APP_ID>` without `--apply`; it must report the active matching rule and exactly one App bypass actor. The first successful workflow CAS push is still required to prove the credential path end to end.

The App ID passed to the setup command is its numeric integration ID, not its Client ID. Until the App is installed, the Client ID variable and environment secrets are configured, and the update-only ruleset is verified, GitHub Pages hosting is available but automatic ledger publication remains **BLOCKED_EXTERNAL**. The scripts fail closed when the dedicated push token is missing.

The owner-run ruleset check proves the stored rule using an administrator credential; it does not prove what the restricted writer App can read. The trusted coordinator verifies the complete ruleset, including the sole App bypass actor, with the App's short-lived `Contents: write` token before any ledger mutation. That preflight must pass after App installation and before automatic publication is treated as operational. If GitHub does not return the bypass actor to that token, keep the workflow fail-closed and resolve the permission/API visibility constraint without silently broadening the App's requested scope.

## Emergency block or unblock

Dispatch `Desktop Release Emergency Controls` from the latest available version tag, such as `desktop-v0.1.0`. The workflow requires the tagged source and workflow file to be the same Gate-A-passed release commit recorded in the Pages ledger. For example:

```sh
gh workflow run desktop-release-controls.yml --ref desktop-v0.1.0 \
  -f action=block -f versions=0.1.0 -f reason="Unsafe release; preparing a fixed version"
```

Select `block` or `unblock`, list one or more semantic versions, and give the reason. The workflow checks that the actor is the repository owner, writes the ledger and safe feed through the Pages compare-and-swap publisher, and updates the corresponding GitHub Release notes.

Release publication, emergency controls, AUR promotion, and release-note updates use the same workflow-level Actions concurrency group. A block waits for an active coordinator to finish, then records the block and warning while holding that group; publishers queued after the ledger commit reread the state and reject the blocked version. GitHub does not guarantee queue order, so a publishing run already queued ahead of the control run may finish before the block is committed. Treat the block as effective only after the emergency workflow completes. A block cannot recall GitHub/AUR artifacts already published, or packages already fetched or installed. A blocked release note says to stop installing that version and to use a higher owner-approved fixed version when available. Do not reuse the blocked version or delete its artifacts.

An unblock action restores eligibility only for the exact version named by the owner. Do not use it to roll clients back to an older build; publish a higher fixed version instead. Safe-feed changes reach clients after Pages propagation, and already cached manifests or staged payloads are checked again by the installed macOS app before activation.

These controls depend on the protected `desktop-release-state` Actions environment, a writable `gh-pages` branch, and working Pages publication. Their current remote readiness is tracked in [STATUS.md](STATUS.md); a local workflow test does not prove that Pages, credentials, or the live dispatch works.
