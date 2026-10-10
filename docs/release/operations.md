# Desktop release operations

## Routine release coordination

`Desktop Release Coordinator` runs after pushes to `main`, on its 15-minute repair schedule, or by manual dispatch on `main`. Use `reconcile` to repair a missed run. Use `minor` only for an explicitly approved next minor series and enter the authorization reason. A PR merge remains the routine release decision; the coordinator does not merge PRs.

For a PR from another author, the latest owner approval must target the final PR head and be submitted before merge. [GitHub does not permit PR authors to approve their own PRs](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews), so for an owner-authored PR the owner's explicit merge is the approval signal; a merge performed by another actor is ineligible. The coordinator verifies this after merge before reserving a version.

The workflow reconciles the actual first-parent `main` history, reruns the exact-SHA gate evidence, and updates `desktop/stable/state.json` and its derived `latest.json` projection in one compare-and-swap commit on `gh-pages`. A reserved version or a successful build is not a public release or an installation result.

## One-time Pages writer setup

The Pages branch accepts ledger updates only from a dedicated `elef-release-state-writer` GitHub App. The App must be installed on the Elef repository only and have repository **Contents: read and write** permission. Do not use the GitHub Actions integration as the branch bypass actor: any same-repository workflow with a write token would otherwise be able to change the ledger. The workflows use a short-lived installation token only for Pages writes; `GITHUB_TOKEN` credentials are not persisted in Pages checkouts. Release writers query the ruleset list and its full record with that scoped App token before distribution and ledger writes, and fail closed unless it is the active repository rule with the App as its sole bypass actor. These reads use the token’s implicit metadata read access; workflow jobs receive no repository administration permission. Branch-rule mutation remains an owner-admin setup action.

After creating and installing the App:

1. Add repository Actions variable `ELEF_RELEASE_STATE_APP_CLIENT_ID` with the App Client ID.
2. Add the same generated App private key as environment secret `ELEF_RELEASE_STATE_APP_PRIVATE_KEY` in `desktop-release-state`, `desktop-release-signing`, and `desktop-aur-publishing`. Keep all three environments restricted to `main`; their other release secrets remain scoped to their existing environment. Never send or commit the key.
3. Give the repository maintainer the numeric App ID. The maintainer sets repository variable `ELEF_RELEASE_STATE_APP_ID`, then from an authenticated repository-admin checkout runs `node desktop/scripts/configure_release_state_ruleset.mjs <APP_ID> --apply`. This creates or updates a separate active rule that matches only `refs/heads/gh-pages`, blocks ordinary updates, and lets only that App bypass the update rule. It leaves the existing deletion and non-fast-forward protection ruleset unchanged, so the App cannot use its bypass to delete or force-push the branch.
4. The maintainer runs `node desktop/scripts/configure_release_state_ruleset.mjs <APP_ID>` without `--apply`; it must report the active matching rule and exactly one App bypass actor. The first successful workflow CAS push is still required to prove the credential path end to end.

The App ID passed to the setup command is its numeric integration ID, not its Client ID. Until the App is installed, the Client ID variable and environment secrets are configured, and the update-only ruleset is verified, GitHub Pages hosting is available but automatic ledger publication remains **BLOCKED_EXTERNAL**. The scripts fail closed when the dedicated push token is missing.

## Emergency block or unblock

Use `Desktop Release Emergency Controls` on the protected `main` ref. Select `block` or `unblock`, list one or more semantic versions such as `0.1.0`, and give the reason. The workflow checks that the actor is the repository owner, writes the ledger and safe feed through the Pages compare-and-swap publisher, and updates the corresponding GitHub Release notes.

Release publication, emergency controls, AUR promotion, and release-note updates use the same workflow-level Actions concurrency group. A block waits for an active coordinator to finish, then records the block and warning while holding that group; publishers queued after the ledger commit reread the state and reject the blocked version. GitHub does not guarantee queue order, so a publishing run already queued ahead of the control run may finish before the block is committed. Treat the block as effective only after the emergency workflow completes. A block cannot recall GitHub/AUR artifacts already published, or packages already fetched or installed. A blocked release note says to stop installing that version and to use a higher owner-approved fixed version when available. Do not reuse the blocked version or delete its artifacts.

An unblock action restores eligibility only for the exact version named by the owner. Do not use it to roll clients back to an older build; publish a higher fixed version instead. Safe-feed changes reach clients after Pages propagation, and already cached manifests or staged payloads are checked again by the installed macOS app before activation.

These controls depend on the protected `desktop-release-state` Actions environment, a writable `gh-pages` branch, and working Pages publication. Their current remote readiness is tracked in [STATUS.md](STATUS.md); a local workflow test does not prove that Pages, credentials, or the live dispatch works.
