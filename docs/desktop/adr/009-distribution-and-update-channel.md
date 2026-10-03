# ADR-009: Distribution via GitHub Releases, signed updater artifacts, and key custody

- Status: **Proposed**
- Date: 2026-10-01
- Decider: Andres
- Confidence: medium (platform behavior is verified in S3 and S4)
- Accepted when: S3 (macOS install + updater cycle) and S4 (Arch AppImage cycle) pass, and the key-custody procedure below is performed

## Context

"Auto-update from day one" and "no Apple Developer ID in v1" are both accepted ([ADR-002](002-tauri-shell.md)). The mechanism was described but its operating decisions — where artifacts live, what is signed, what happens when the signing key is lost — had no home. The updater key is the single most powerful secret in the project: whoever holds it can ship code to every installed copy.

## Options considered

- **GitHub Releases + Tauri updater, Ed25519-signed, unsigned macOS app** (chosen). No server to run; no paid identity.
- **Own update server.** More control, more to operate; unnecessary for two devices.
- **Developer ID signing + notarization.** Best macOS first-run UX; costs $99/yr; deferred, not rejected.
- **Manual reinstall only.** Contradicts the preference.

## Decision (proposed)

- **Channel:** one stable channel. Updates come from GitHub Releases (`latest.json` plus signed artifacts), over HTTPS only. No downgrade by default.
- **Release version:** `desktop-vMAJOR.MINOR.PATCH` is validated before building. The generated Tauri release config takes its version from that tag, so later releases cannot accidentally publish the development config's `0.1.0` under a newer release name. Placeholder or malformed public keys fail before packaging.
- **Artifacts:** macOS (Apple Silicon) `.app`/`.dmg` plus the updater archive, unsigned and not notarized; Linux AppImage (Tauri's Linux updater target).
- **Signing:** the updater verifies the Ed25519 signature against the public key baked into the app before installing and requires its authenticated version to match the manifest (`requireSignedVersion`). The pinned Tauri CLI automatically signs the version during `tauri build`; manual artifact signing must supply `--app-version`. The macOS Gatekeeper warning on first install is accepted and documented (S3).
- **Releases come from CI only,** from tags; the private key is a repo secret and never on a developer machine except in backups.
- **Key custody:** keep two offline encrypted backups of the private key in separate places (human gate in [delivery-plan.md](../delivery-plan.md)). Use a passphrase.
- **Failed update:** a corrupt, badly signed or interrupted update leaves the previous version runnable (QS-8).
- **Rotation procedure (if the key is suspected compromised, but still available):** ship an update, signed with the old key, that embeds a new public key; subsequent releases use the new key. **If the key is lost,** installed copies cannot be updated and need a manual reinstall of a build with a new public key. Write down which of these applies before the first release.

## Consequences

- No servers, no accounts, no recurring cost.
- A leaked key means arbitrary code on every installed copy (threat T7 in [security.md](../security.md)); repository and Actions access are part of the trust base.
- macOS first-run friction remains until a Developer ID is acquired. Acceptable while the audience is the owner's own devices.

## Revisit when

The app is distributed to people other than the owner, a Developer ID becomes acceptable, or S3 shows an OS change that blocks unsigned updates.
