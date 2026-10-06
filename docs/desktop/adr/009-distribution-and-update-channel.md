# ADR-009: Signed desktop updates through GitHub Releases

- Status: Proposed
- Date: 2026-10-01
- Decider: Andres
- Confidence: medium
- Accepted when: macOS and Linux install/update evidence is complete and production updater key custody has been performed

## Context

Desktop should update itself on both supported platforms without an update server or Apple Developer ID. Update verification is a security boundary because a signing key can authorize executable code.

## Options considered

- GitHub Releases with Tauri's Ed25519 update verification.
- Operate a dedicated update service.
- Distribute manual builds only.

## Decision

Publish signed update artifacts through GitHub Releases. The application verifies updates against its configured public key and uses the native installation confirmation and replacement flow. Release packaging is defined in [the desktop release workflow](../../../.github/workflows/desktop-release.yml).

## Consequences

- Production release credentials and two offline encrypted private-key backups are owner-managed release requirements; test fixtures use ephemeral keys.
- A lost production key strands installed versions; a compromised key can authorize malicious releases.
- Unsigned macOS first-install friction remains until Developer ID signing is adopted. See [install and use](../install-and-use.md).

## Revisit when

Distribution expands beyond the owner, key custody changes, or a platform change blocks the signed update path.
