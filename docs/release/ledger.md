# Desktop release ledger

The release workflow's only mutable central state is `desktop/stable/state.json` on the repository's `gh-pages` branch. `desktop/stable/latest.json` is generated from that ledger in the same branch commit. `desktop/release/ledger.mjs` owns deterministic transitions; `desktop/release/pages-state.mjs` serializes state and derives the updater feed from one validated snapshot. The checked-in writer does not create a second release record.

## State shape

The schema version 1 ledger contains:

- `revision`: monotonically increases for each accepted state transition and protects publishers from stale reads.
- `last_reconciled_main`: current `main` head SHA included in the last reconciliation.
- `current_minor`: manually selected `major.minor` series; PR labels do not change it.
- `minor_changes`: actor, reason, and timestamp for each authorized milestone change.
- `reserved_versions`: immutable version/tag reservations, including preexisting tag gaps and failed unpublished reservations.
- `processed_merges`: one record per approved main merge, with exact source SHA, PR, first-parent order, gate result, and reservation if Gate A passed.
- `releases`: platform delivery state for each gate-passing reservation.

Each release records the constitutional minimum fields: `version`, `tag`, `main_sha`, `pr`, `gate`, `macos`, `linux_asset`, `aur`, `blocked`, `reason`, and `created_at`. Platform objects use `pending`, `passed`, `failed`, or `superseded` and retain immutable artifact metadata when available. A release becomes public when its first validated macOS or Linux asset is distributed.

`.github/workflows/desktop-release.yml` invokes reconciliation after `main` pushes, every 15 minutes, and on demand. The workflow uses the maximum Actions concurrency queue; the reconciler still sorts full first-parent history and does not rely on event order. It requires the repository owner's approval of the merged PR's final head before merge, checks every required job from the `ci.yml` push run for that exact merge SHA, and stops its watermark before a merge whose PR association/record or Gate A result is incomplete. Manual minor/block/unblock controls run only from `main` and require the repository owner plus an explicit reason.

## Transition rules

- Reconciliation consumes approved, merged PRs in `git rev-list --first-parent --reverse` order. Duplicate merge events are no-ops. A failed Gate A merge is recorded without a version; repair requires a new approved PR.
- The first unused version is `0.1.0`. A passing merge reserves the next patch in the explicitly selected minor series. Reservations are never reassigned, so a failed unpublished reservation can leave a gap.
- Platform publication checks the ledger revision, source SHA, version, immutable GitHub asset URL, and checksum. macOS publication also requires both DMG/updater archive metadata and a signature already verified by the publishing job. A retry may reuse only the same recorded artifact metadata.
- A newer platform publication supersedes older pending/failed delivery for that platform. A lower version cannot publish after a higher version is already passed.
- AUR publication requires the public release's validated Linux asset and a PKGBUILD/.SRCINFO checksum tied to that exact archive. AUR publication status is separate from Linux asset status.
- Emergency block/unblock records actor and reason. A block prevents new platform writes and removes that version from the derived macOS feed. It does not remove already published GitHub/AUR artifacts.
- `latest.json` is a projection of the newest unblocked macOS release with a passed signature-verified ARM64 updater archive. Linux and AUR states never enter the Tauri updater feed.

`desktop/release/pages-publisher.mjs` fetches `gh-pages`, regenerates both files, and commits them together. A rejected push is classified by rereading the branch: when the remote advanced, the publisher resets to that state and reruns reconciliation before retrying; when it did not advance, publication fails with a branch-rule/credential error. It never force-pushes. The workflow needs repository Pages configuration and a protected `gh-pages` branch that permits only this trusted writer; those remote settings and the serving URL remain external acceptance items.

`desktop/release/ledger.test.mjs`, `desktop/release/pages-state.test.mjs`, `desktop/release/reconciler.test.mjs`, `desktop/release/github-api.test.mjs`, and `desktop/release/pages-publisher.test.mjs` exercise reconciliation order, duplicate events, failed gates, version gaps, partial delivery, retries, superseding, checksums/signatures, manual minor selection, blocks, stale writers, same-snapshot state/feed generation, owner approvals before merge, incomplete PR/API records, pending exact-SHA checks, and local compare-and-swap retry behavior. These tests use mocked GitHub API/Git responses and prove local behavior only. The workflow has not run against GitHub; branch protection, GitHub Pages availability, publishing credentials, and real artifact publication remain separate acceptance items in [STATUS.md](STATUS.md).
