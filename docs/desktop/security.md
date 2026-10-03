# Elef Desktop — Security Model (seam spec)

Status: draft v3 (revised 2026-10-02). The living threat model and control list. The decision to adopt this approach is [ADR-006](adr/006-security-model.md); this file holds the details so the ADR stays short. Verification is mapped to tests in [test-strategy.md](test-strategy.md).

## 1. Why the web threat model does not transfer

On desktop the webview has IPC to a backend that reads and writes files. A deck folder or `.elef` file is **untrusted input**: someone else's deck, a downloaded sample, a synced folder another program writes into. The web renderer's `filter_html: true` plus URL allowlist is a start, not a model.

Principle: **assume breach at every layer.** The renderer sanitizer will eventually have a bug; the design must still hold when hostile script runs in the webview.

## 2. Assets and trust boundaries

Assets: the user's deck files; the library root; the update-signing key; the IPC command surface.

| Boundary | Untrusted side | Trusted side |
|---|---|---|
| B1 | Deck Markdown / HTML-ish content | Renderer, DOM |
| B2 | Webview JS (including anything injected via B1) | Rust commands |
| B3 | Archive entries and folder contents | Filesystem under the library root |
| B4 | Update server response | Installer |
| B5 | Other programs writing the folder | The app's in-memory state |

## 3. Threats and controls

| ID | Threat | Controls | Verified by |
|---|---|---|---|
| T1 | Hostile deck content yields script that reaches IPC | C1 sanitization, C2 CSP, C3 Mermaid strict, C8 commands safe when hostile, C11 single DOM insertion point | Hostile-deck fixtures (T0, T2); runtime probe on macOS and Linux in [CI run 37061835922](https://github.com/Hansespinosa2/elef/actions/runs/37061835922); [S5 report](spike-results/S5-hostile-deck-probe.md) |
| T2 | Hostile URLs: `javascript:` links, `data:` documents, exfiltrating remote images | C1 `SAFE_URL` allowlist, C2 CSP `img-src`, remote images blocked in v1 (Q5) | T0 and T2 hostile-deck assertions; CSP asserted in CI |
| T3 | Path traversal, symlink escape, absolute paths | C5 path discipline, C4 scoped commands; media reads are addressed by deck ID and verified SHA-256 | T0 traversal fixtures |
| T4 | Hostile archives: zip-slip, symlink entries, zip-bomb | C6 import hardening | T0 + T3 archive fixtures |
| T5 | Renderer JS can invoke more than it needs | C4 least-privilege capabilities, C8 | Capability file equals command table (CI fitness) |
| T6 | Denial of service: pathological Markdown, regex blow-up, huge diagrams or images | C9 render time and memory limits | T0 stress fixtures |
| T7 | Malicious or compromised update | C10 signature verification, HTTPS only, key custody (ADR-009) | T3 update failure injection |
| T8 | Supply chain: npm and cargo dependencies | C12 lockfiles, pinned versions, audit in CI, minimal renderer-bundle dependencies | CI audit step |
| T9 | Another program tampers with folder content while the app runs | Treat all reads as untrusted input (same controls as T1, T3); fingerprint check (ADR-008) | T0, T2 |

## 4. Controls

- **C1 Renderer sanitization.** The shared JS renderer replicates the Ruby semantics: raw HTML filtered (`filter_html: true` equivalent); links and images restricted to the `SAFE_URL` allowlist (http, https, mailto, tel, fragment, relative). No `javascript:`.
- **C2 Strict CSP** on the webview: our bundle only, no inline scripts, no remote origins. `script-src` is never relaxed. `style-src` stays `'self'`; `style-src-attr 'unsafe-inline'` is required for CodeMirror's runtime geometry and KaTeX's generated formula layout attributes. Inline `<style>` blocks remain blocked. CI asserts the shipped policy, and the hostile-deck probe exercises it in the actual macOS and Linux system webviews (see [S5 report](spike-results/S5-hostile-deck-probe.md)). The probe establishes behavior for its fixture corpus, not every possible payload.
- **C3 Mermaid `securityLevel: 'strict'`.** The renderer emits placeholders only; Mermaid runs in the webview.
- **C4 Tauri capabilities, least privilege.** The frontend may invoke a named command set only ([transport-adapter.md](transport-adapter.md)). File commands are scoped to the library root; there is no generic "write this path" command; `upload_asset` validates bytes and can only create content-addressed files under one deck's `images/`; no shell; no raw fs access from the renderer. A webview or window matching no capability has no IPC access at all.
- **Test-only WebdriverIO.** The embedded WebDriver and WebdriverIO command plugins are compiled only with the explicit `webdriver` feature and attached through the separate E2E config. The E2E-only frontend initializer, global Tauri API, and capabilities live in a separate test build and bind to localhost. Production config, frontend output, capabilities, and default Cargo features exclude them; CI asserts these boundaries.
- **C5 Backend path discipline.** Every path is canonicalized (symlinks resolved) and verified to be contained in the library root before any read or write. `..` escapes rejected. Symlinks are not followed during deck discovery. Commands take deck IDs, not paths, wherever possible.
- **C6 Import hardening.** Reject absolute paths, `..`, and symlink or special-file entries in zip entries. Cap total uncompressed size (500 MB), entry count (10k), and flag absurd compression ratios. Extract to a staging dir; nothing touches the library root until validation passes.
- **C7 Write safety.** Fingerprint check before every save; real conflict surfaced instead of overwriting (ADR-008).
- **C8 Commands safe when hostile.** Treat every command as callable by hostile script: validate all arguments, operate only on decks inside the library root, no destructive command without an explicit user-initiated path (native dialog or UI confirmation owned by the shell).
- **C9 Render limits.** The renderer worker has a wall-clock limit and is terminated on overrun. On the Rails side, mini_racer contexts support a timeout and a memory limit; set both (ADR-007).
- **C10 Updates.** Ed25519 signature verified against the baked-in public key before install; `requireSignedVersion` binds the manifest version to the artifact's authenticated trusted comment, rejecting replay of an older signed artifact under a newer version number. Production endpoints use HTTPS and reject insecure transport; no downgrade by default (ADR-009). Checks have a 10-second timeout and downloads a 120-second timeout. Closing an unused update dialog releases its native resource through the scoped `core:resources:allow-close` permission. Test builds alone use a loopback fixture endpoint and an ephemeral public-key override; no production private key is involved.
- **C11 Single DOM insertion point.** Desktop preview HTML reaches the DOM through `installSanitizedPreview`, which applies a second allowlist pass immediately before insertion; component tests and the hostile-deck probe cover this sink. Rails has a separate insertion path and server-renderer controls. A representative WebView performance measurement for the desktop sanitizer remains part of S5 closeout.
- **C12 Supply chain.** Committed lockfiles, exact versions for the renderer bundle and Tauri, `cargo audit` and `npm audit` in CI, and tracking of Tauri security advisories. Cargo audit denies new warnings; the four exact Tauri/GTK transitive advisories recorded in [R13](risks-and-open-questions.md#risk-register) are temporarily ignored and must be revisited at the next Tauri stack upgrade. The E2E lockfile overrides vulnerable test-tool transitive dependencies to patched releases while retaining the high-severity audit gate.

## 5. Known platform caveat: iframes and IPC

Do not rely on an iframe, sandboxed or not, as the boundary between untrusted content and IPC. A published advisory for Tauri (CVE-2024-35222) describes iframes in a Tauri app reaching Tauri IPC, including with isolation mode on, and notes that on Linux a dedicated window or webview is needed to get iframe-like separation. The hostile fixture now runs against the pinned Tauri build on macOS and Linux; the tested `srcdoc` frame and attempted IPC side effect were neutralized in [CI run 37061835922](https://github.com/Hansespinosa2/elef/actions/runs/37061835922). This replaces the earlier blanket “unverified” status for that corpus only. It does not prove arbitrary iframe payloads cannot reach IPC. C1, C2 and C8 remain independent controls; a separate webview with no capability is an optional extra layer, not a replacement.

## 6. Residual risks

- A sanitizer bypass plus a permissive CSP would let hostile script call commands. C8 bounds the damage to the library root; it does not make it zero (a hostile script could still save over a deck inside the root). The S5 fixture provides evidence against its enumerated attacks; it does not eliminate this residual risk, which is why C2's `script-src` never relaxes.
- Unsigned macOS builds: a user can be tricked into installing a fake build. Accepted for v1 (owner's two devices); revisit before wider distribution (ADR-009).
- Remote images: blocked in v1. A static CSP cannot express a per-deck opt-in. Options if wanted later: a Rust-side fetch proxy with SSRF checks and size caps, or a deliberately loosened `img-src` (Q5).
- The `elefasset` protocol accepts GET only and serves either digest-verified assets or a normalized relative file below one deck's `images/`; it rejects traversal, symlinks, and special files. `upload_asset` is an explicit capability and never overwrites an existing content-addressed file; it caps each asset at 50 MiB and each deck's `images/` tree at 400 MiB and 10,000 entries. A script that bypasses sanitization could add a bounded new image under a deck but cannot choose a destination path or overwrite another asset.
