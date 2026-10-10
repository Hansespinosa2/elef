# Desktop release operations

## Routine release coordination

`Desktop Release Coordinator` runs when the `CI` workflow completes on a `main` push, hourly at minute 17 UTC, and on owner dispatch. It proceeds from a push event only when the workflow source SHA and current `main` head match the completed CI SHA, so a newer merge waits for its exact-SHA Gate A. Ordinary reconciliation uses the latest trusted tooling SHA, processes full first-parent history, and does not infer release order from event order. GitHub runs scheduled workflows only from the default branch, and can delay or drop them under load; the schedule is a recovery path, not proof that a run occurred.

To repair a missed event, the repository owner can dispatch from `main`; the preflight verifies the exact workflow SHA, owner authorization, and Gate A before reconciliation:

```sh
gh workflow run desktop-release.yml --ref main -f action=reconcile
```

Before any Gate-A-passed tooling SHA exists, a failed or cancelled first Gate A can use a failure-only bootstrap from the exact current `main` revision. It verifies the main ref, active review/CODEOWNERS rules, merged PR, repository-owner approval (or owner merge for an owner-authored PR), and terminal failed Gate A. A completed `workflow_run`, exact-main hourly schedule, or owner `reconcile` dispatch can enter this path; `minor` cannot. The bootstrap runs a dedicated owner-reviewed recorder. It appends only the failed merge record, leaves the main watermark unchanged, creates no version reservation or platform candidate, and skips tag/draft creation and platform publication. Its Actions token is read-only; the dedicated Pages App token is used for the compare-and-swap update. A later Gate-A-passed coordinator performs ordinary history reconciliation.

Each recorded failure keeps an acknowledgment bit in the same ledger. Before acknowledging through the serialized Pages CAS writer, the workflow creates or confirms an issue assigned to the repository owner and explicitly mentions them; retries reuse the issue for that exact SHA. Acknowledgment means the issue was durably created or confirmed, not that a person read it. Cancellation before the CAS acknowledgment leaves it eligible for retry. The active `main` ruleset requires approval and CODEOWNERS review; its live configuration was verified on 2026-10-10. Ledger writes and acknowledgment still require the Pages App and a successful CAS push.

Use `minor` only for an explicitly approved next minor series and provide the authorization reason. A PR merge remains the routine release decision; the coordinator does not merge PRs.

For a PR from another author, the latest owner approval must target the final PR head and be submitted before merge. [GitHub does not permit PR authors to approve their own PRs](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews), so for an owner-authored PR the owner's explicit merge is the approval signal; a merge performed by another actor is ineligible. The coordinator verifies this after merge before reserving a version.

The repository-owner CODEOWNERS entries protect the CI workflow, privileged release workflows, trust verifier, and publishing state machine. Active repository ruleset `23894784` requires at least one approving review and CODEOWNERS review. On 2026-10-10, the owner applied a pull-request-only bypass for their own GitHub user so owner-authored PRs remain mergeable; the owner is the only repository admin. The live ruleset and effective branch-rules endpoint were read back, and the coordinator's `verifyMainReviewProtection()` preflight passed. Keep this as a repository ruleset because classic branch protection alone is not accepted by the preflight. The effective-rules query handles inherited and pattern-based rulesets, but is only a presence check and does not expose bypass actors. Release eligibility separately verifies the latest owner approval on the exact PR head, or, for an owner-authored PR, that the owner performed the merge. Review the live bypass list whenever repository admin access changes.

The workflow reconciles the actual first-parent `main` history, reruns the exact-SHA gate evidence, and updates `desktop/stable/state.json` and its derived `latest.json` projection in one compare-and-swap commit on `gh-pages`. A reserved version or a successful build is not a public release or an installation result.

## One-time Pages writer setup

The Pages branch accepts ledger updates only from a dedicated `elef-release-state-writer` GitHub App. The App must be installed on the Elef repository only and have repository **Contents: read and write** permission. Do not use the GitHub Actions integration as the branch bypass actor: any same-repository workflow with a write token would otherwise be able to change the ledger. The workflows use a short-lived installation token only for Pages writes; `GITHUB_TOKEN` credentials are not persisted in Pages checkouts. Release writers query the ruleset list and full record with that scoped App token before distribution and ledger writes, and fail closed unless visible conditions and rules match the active update-only repository rule. When GitHub exposes `bypass_actors`, runtime also requires the App to be the sole bypass actor. GitHub may omit that field for a Contents-only App, so the writer additionally requires the ruleset's `updated_at` to match the administrator-verified repository variable `ELEF_RELEASE_STATE_RULESET_UPDATED_AT`. This detects later edits without granting the App repository administration permission. Branch-rule mutation remains an owner-admin setup action.

Create it in **Developer settings → GitHub Apps → New GitHub App** with these values:

- **Name:** `elef-release-state-writer`
- **Description:** `Used by Elef’s trusted desktop release workflow to maintain the stable release ledger and derived update manifest on the gh-pages branch.`
- **Homepage URL:** `https://github.com/Hansespinosa2/elef`
- **Repository permission:** `Contents: Read and write`. Leave every other permission at No access; GitHub may add `Metadata: Read-only` automatically.
- **Installation target:** only the `Hansespinosa2` account. When installing, choose only the `elef` repository.
- Leave OAuth authorization, redirect/setup URLs, device flow, webhooks, and subscribed events disabled or blank. Grant no user, organization, account, or enterprise permissions.

After creating and installing the App:

1. In the Elef repository, open **Settings → Secrets and variables → Actions → Variables → New repository variable**. Set the name to `ELEF_RELEASE_STATE_APP_CLIENT_ID` and the value to the App's **Client ID** from its General settings page. Save it as a repository variable, not an environment variable. The Client ID is an identifier, not a secret.
2. Generate a private key from the App's **General → Private keys** section and download the `.pem` file. In **Settings → Environments**, open `desktop-release-state`, `desktop-release-signing`, and `desktop-aur-publishing`; in each environment add the same full key contents as the secret `ELEF_RELEASE_STATE_APP_PRIVATE_KEY`. Keep `desktop-release-signing` and `desktop-aur-publishing` restricted to `main`. `desktop-release-state` must allow the `main` branch and the `desktop-v*` tag pattern because manual reconciliation and emergency controls run from an immutable release tag. Those two state-environment policies were verified through the GitHub API on 2026-10-10. Keep all other release secrets in their existing environments. Never send or commit the key.
3. Give the repository maintainer the numeric App ID. The maintainer sets repository variable `ELEF_RELEASE_STATE_APP_ID`, then from an authenticated repository-admin checkout runs `node desktop/scripts/configure_release_state_ruleset.mjs <APP_ID> --apply`. This creates or updates a separate active rule that matches only `refs/heads/gh-pages`, blocks ordinary updates, and lets only that App bypass the update rule. It leaves the existing deletion and non-fast-forward protection ruleset unchanged, so the App cannot use its bypass to delete or force-push the branch.
4. Run `node desktop/scripts/configure_release_state_ruleset.mjs <APP_ID>` without `--apply` and verify the administrator-visible record contains exactly one App bypass actor. Copy the printed `updated_at` value into repository variable `ELEF_RELEASE_STATE_RULESET_UPDATED_AT`. Re-run the command and retain its output as setup evidence. If the ruleset is edited later, repeat this admin verification and update the variable. The first successful workflow CAS push is still required to prove the restricted App credential path end to end.

The App ID passed to the setup command is its numeric integration ID, not its Client ID. Until the App is installed, the Client ID variable and environment secrets are configured, and the update-only ruleset is verified, GitHub Pages hosting is available but automatic ledger publication remains **BLOCKED_EXTERNAL**. The scripts fail closed when the dedicated push token is missing.

The owner-run ruleset check proves the complete stored rule using an administrator credential; it does not prove what the restricted writer App can read. The trusted coordinator verifies the visible rule shape and administrator-pinned revision with the App's short-lived `Contents: write` token before any ledger mutation. If GitHub returns the bypass actor, it must match the sole configured App. This preflight must pass after App installation and before automatic publication is treated as operational.

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
