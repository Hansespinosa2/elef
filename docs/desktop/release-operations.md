# Desktop release operations

Reach for when: tagging a desktop release, watching Gate A, publishing the draft, blocking a bad release, or recovering Linux installs.

The v0.x release is tag-driven: a `desktop-v*` tag opens a draft GitHub Release, CI-built evidence gates it, and a human publishes it. There is no coordinator, ledger, or Pages feed; the updater reads the GitHub Releases `latest.json` feed. Every machine-checked claim below names its enforcer.

## Tag a release

Tag the release commit after the `dev` → `main` promotion as `desktop-vX.Y.Z` and push the tag:

~~~sh
git tag desktop-0.1.0
git push origin desktop-0.1.0
~~~

The release workflow triggers on `desktop-v*` tags only (enforced by `check_release_ci.mjs`). Pushing the tag starts the `macos` job, which builds the Apple Silicon app plus DMG, signs the updater artifacts, and opens the release as a **draft** with `latest.json` attached. Nothing is offered to users until the draft is published.

## Draft to publish flow

Jobs run in this order (enforced by `check_release_ci.mjs` against `desktop-release.yml`):

1. `macos` opens the draft with the signed DMG, the signed updater archive, and `latest.json`. It is the only job that writes updater JSON.
2. `arch-asset` builds the plain Linux archive in the pinned Arch container and uploads `elef-<version>-x86_64.tar.zst` plus its `.sha256` and `.provenance.json` sidecars to the draft. It carries no updater JSON: Linux upgrades through its package manager, never through the in-app updater.
3. `publish` flips the complete draft to published once both asset jobs succeed.
4. `aur-publish` runs after publication inside the protected `desktop-aur-publishing` environment. It revalidates the public asset and sidecars against the tag and the Release API source SHA, regenerates `.SRCINFO`, rechecks the package name against the AUR registry, and pushes `PKGBUILD` + `.SRCINFO` over SSH. It refuses to replace existing metadata or push an older version over a newer one, and it records the selected package name in the release notes on every publish. When no AUR account is configured yet (both `AUR_ACCOUNT_NAME` and `AUR_SSH_PRIVATE_KEY` unset, e.g. while AUR registrations are closed), the publisher exits cleanly without pushing; the Arch asset release is unaffected.

The macOS updater polls `https://github.com/Hansespinosa2/elef/releases/latest/download/latest.json`, which GitHub resolves to the newest published release that is neither draft nor prerelease. Downloads are signed and verified by Elef before installation.

## Gate A procedure

Gate A is the `release-gate` CI job: it waits for all thirteen evidence jobs, checks out the exact gated SHA, re-runs `check_release_ci.mjs`, and records `SOURCE_SHA` in the run summary (all enforced by `check_release_ci.mjs` itself). The evidence jobs are `desktop-fast`, `scan_ruby`, `scan_js`, `test`, `sqlite-test`, `system-test`, `affected`, `desktop`, `arch-package`, `desktop-macos`, `renderer-macos`, `production-smoke`, and `development-smoke`.

The gate follows the normal CI triggers (pull requests, pushes to `dev`/`main`, manual dispatch) and adds no branch condition of its own. On branch pushes the pull-request-only evidence jobs skip, so the gate skips with them; Gate A evidence is a pull-request gate. When it is red, fix the failing evidence job and re-run; never bypass the gate, weaken an assertion, or hand-edit generated evidence to obtain green.

The pinned Arch image digest appears in three workflow spots (the CI `arch-package` job, the release `arch-asset` and `aur-publish` jobs) and must agree everywhere (enforced by `check_release_ci.mjs`). To refresh it, resolve the current `linux/amd64` digest of the official image, update all three references together, and update the currency note in `apps/desktop/release-test-manifest.json`.

## Emergency block

A blocked release stops future automated promotion and removes the macOS update offer, but it cannot erase already-fetched AUR metadata or reliably downgrade installed packages. Already published artifacts and AUR Git history are retained. The GitHub Release notes are the authoritative warning while AUR metadata may be stale.

Block a bad release in this order:

1. Warn. Prepend a `BLOCKED` banner to the release notes naming the affected version and the fixed version (or that none exists yet):
   ~~~sh
   gh release view desktop-0.1.0 --json body --jq .body > /tmp/elef-release-notes.md
   # Prepend the BLOCKED banner, then:
   gh release edit desktop-0.1.0 --notes-file /tmp/elef-release-notes.md
   ~~~
2. Remove the macOS offer. Flip the release to prerelease so `/latest` no longer serves its `latest.json`, then verify the feed moved past it:
   ~~~sh
   gh release edit desktop-0.1.0 --prerelease
   curl -fsSL https://github.com/Hansespinosa2/elef/releases/latest/download/latest.json | head -c 300
   ~~~
   Keep the published assets in place: deleting the release would break AUR upstream URLs and the audit trail. The DMG stays downloadable but is marked blocked.
3. Stop AUR promotion. Push no new AUR revision for the blocked version. The publisher's never-downgrade guard is not bypassed for a block: recovery is always a higher fixed version, never an older version pushed over a newer one.
4. Recover with a fixed version. Tag a higher `desktop-vX.Y.Z`, let the normal draft → publish → AUR flow run, and name the superseded blocked version in the new release notes. For installed Linux clients, follow the [Arch package recovery runbook](../../apps/desktop/packaging/arch/README.md#aur-publishing-and-recovery), which also covers manual downgrade to a known-good AUR revision.

## Owner-secrets checklist

Values are never committed. CI jobs receive no secrets at all (enforced by `check_release_ci.mjs`); only the tag-driven release workflow holds them:

| Secret or variable | Kind | Scope | Consumer |
|---|---|---|---|
| `TAURI_UPDATER_PUBKEY` | Actions variable | Repository | `prepare-updater-config.mjs` merges it into the release updater config |
| `TAURI_SIGNING_PRIVATE_KEY` | Secret | Repository | `macos` release job signs the updater artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secret | Repository | `macos` release job unlocks the signing key |
| `AUR_ACCOUNT_NAME` | Protected variable | `desktop-aur-publishing` environment | `aur-publish` job selects the AUR account |
| `AUR_SSH_KNOWN_HOSTS` | Protected variable | `desktop-aur-publishing` environment | `aur-publish` job pins the AUR host keys |
| `AUR_SSH_PRIVATE_KEY` | Secret | `desktop-aur-publishing` environment | `aur-publish` job pushes over SSH |

The updater-config script and the release workflow fail closed without these: a bare workstation build never ships a signed feed, and the protected environment keeps the AUR key away from pull-request runs.

## Package-name decision

The supported Linux package is normally `elef-bin`, or `elef-desktop-bin` if `elef-bin` belongs to another maintainer when Elef first registers. The publisher rechecks AUR ownership on every run and records the selected name in the release notes, so the notes always name the package to install. The CI gate builds and exercises both names.

## v0 rehearsal checklist

Run these on real hardware before calling a v0 release validated:

- Apple Silicon: DMG install, Gatekeeper first-launch approval via the per-app Open Anyway exception, packaged N-1 → N update, blocked-version exclusion from the update offer, post-upgrade relaunch, and post-update Gatekeeper approval for the updater-replaced app.
- Linux: AUR install and upgrade through the system package manager, including an `omarchy update` rehearsal on Omarchy.
- Feed: blocked-release flip removes the `latest.json` offer (see Emergency block), and the fixed higher version becomes the offered update.
