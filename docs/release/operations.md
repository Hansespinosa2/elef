# Desktop release operations

## Routine release coordination

`Desktop Release Coordinator` runs after pushes to `main`, on its 15-minute repair schedule, or by manual dispatch on `main`. Use `reconcile` to repair a missed run. Use `minor` only for an explicitly approved next minor series and enter the authorization reason. A PR merge remains the routine release decision; the coordinator does not merge PRs.

For a PR from another author, the latest owner approval must target the final PR head and be submitted before merge. [GitHub does not permit PR authors to approve their own PRs](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews), so for an owner-authored PR the owner's explicit merge is the approval signal; a merge performed by another actor is ineligible. The coordinator verifies this after merge before reserving a version.

The workflow reconciles the actual first-parent `main` history, reruns the exact-SHA gate evidence, and updates `desktop/stable/state.json` and its derived `latest.json` projection in one compare-and-swap commit on `gh-pages`. A reserved version or a successful build is not a public release or an installation result.

## Emergency block or unblock

Use `Desktop Release Emergency Controls` on the protected `main` ref. Select `block` or `unblock`, list one or more semantic versions such as `0.1.0`, and give the reason. The workflow checks that the actor is the repository owner, writes the ledger and safe feed through the Pages compare-and-swap publisher, and updates the corresponding GitHub Release notes.

For a block, the workflow then requests cancellation of an active ordinary release coordinator. Any platform publisher still in progress also rechecks the ledger immediately before publication and its ledger write is rejected if the version is blocked. A narrow race remains if an external upload or AUR push has already passed that last check; GitHub/AUR artifacts already downloaded or installed cannot be remotely recalled. A blocked release note says to stop installing that version and to use a higher owner-approved fixed version when available. Do not reuse the blocked version or delete its artifacts.

An unblock action restores eligibility only for the exact version named by the owner. Do not use it to roll clients back to an older build; publish a higher fixed version instead. Safe-feed changes reach clients after Pages propagation, and already cached manifests or staged payloads are checked again by the installed macOS app before activation.

These controls depend on the protected `desktop-release-state` Actions environment, a writable `gh-pages` branch, and working Pages publication. Their current remote readiness is tracked in [STATUS.md](STATUS.md); a local workflow test does not prove that Pages, credentials, or the live dispatch works.
