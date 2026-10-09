# Desktop security

Decks, Markdown, media, and .elef archives are untrusted input. The webview has access to a small native command surface, so sanitization is one layer rather than the trust boundary.

## Webview boundary

The shipped policy is configured in apps/desktop/src-tauri/tauri.conf.json and checked by apps/desktop/scripts/check_architecture.py:

- Scripts are self-only. The policy does not allow inline scripts or eval.
- Frames are disabled; network connections are limited to Tauri IPC.
- Remote images are blocked. Local app, asset, and elefasset protocols supply packaged and deck-local media.
- CodeMirror 6's `style-mod` inserts its base and theme rules in a `<style>` element, so the CSP permits inline style elements. Inline style attributes are also used for CodeMirror geometry and KaTeX formula layout. This is why style-src allows unsafe-inline; script-src remains self-only.

The preview sanitizer validates rendered content before it reaches the DOM. Mermaid uses strict mode. The hostile-deck workflow exercises representative script, event-handler, frame, unsafe-link, remote-fetch, and remote-media payloads against web and native paths. Passing that corpus does not prove that arbitrary malicious input is harmless.

## Native commands and files

- Tauri capabilities expose named commands, not generic filesystem or shell access. The capability list is checked against command registration and the desktop adapter.
- Rust commands validate their inputs, resolve deck identifiers through the selected library, canonicalize paths, and enforce containment. Discovery does not follow symlinks.
- Source and settings updates use atomic replacement and fingerprint checks. The check-to-replacement window against an external writer remains a documented residual race; the editor displays that warning.
- Archive import rejects traversal paths, symlinks, and special files, applies size and compression limits, extracts in staging, then moves validated content into the library.
- The asset protocol is read-only and scoped to one deck's images. Uploaded media is content-addressed and cannot overwrite another asset.

## Updates and dependency checks

Updater artifacts are signed and verified against the public key configured into the app. Release packaging and signing are in .github/workflows/desktop-release.yml. Dependency audit and native capability/CSP checks run in CI.

For the decision record and verification limits, see [ADR-006](adr/006-security-model.md) and [development and testing](../development.md).
