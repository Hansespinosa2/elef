# S5 — Hostile-deck IPC probe

Status: runtime attack matrix passed in CI on 2026-10-02. This report records evidence for the fixture corpus, not a general proof that hostile content cannot reach the application.

## Evidence

- Commit: `2eb6681078498025037b8bddc7b45afc86b7fed7`
- CI: [run 37061835922](https://github.com/Hansespinosa2/elef/actions/runs/37061835922), successful `desktop` (Linux) and `desktop-macos` jobs.
- The same `hostile-deck-neutralized` scenario runs through Playwright against Rails and WebdriverIO against the real Tauri binary. The desktop job exercises the system webview on Linux and macOS.
- The fixture attempts inline script execution, event-handler execution, an iframe `srcdoc` payload that posts to its parent, a remote `fetch`, a `create_deck` Tauri IPC call, `javascript:` links, a remote image, and a `data:` image.
- The scenario checks for executed script/event/frame markers, inline event attributes, executable DOM elements, unsafe link/media URLs, and remote resource requests. After the desktop scenario, the runner also verifies the attempted IPC call did not create a deck.
- Both OS jobs passed these assertions. The shipped CSP is separately checked by the architecture CI script; the probe therefore tests the sanitized preview under the shipped webview policy.

## Result and limits

The listed attacks were neutralized on both tested operating systems. The test also confirms this Tauri build did not allow the tested rendered payload to invoke `create_deck`. It covers one deliberate payload set; it does not establish that every sanitizer bypass, IPC path, iframe behavior, or network request is impossible. Commands must continue to validate hostile inputs and stay scoped to the library root.

The desktop DOM sink applies `installSanitizedPreview` before insertion, and frontend component tests cover its allowlist behavior. A representative real-WebView timing measurement for this second-pass sanitizer was not part of run 37061835922 and remains open. The CSP policy and its CodeMirror/KaTeX style exception are documented in [security.md](../security.md); this report does not claim the policy is the mathematically tightest possible policy.

## Follow-up

- Measure the sanitizer with representative large previews in the supported webviews and record the result against the rendering budget.
- Re-run the hostile probe when upgrading Tauri or changing the preview sanitizer, CSP, renderer, or Tauri capabilities.
- Keep broad fuzzing and additional hostile fixtures in the test strategy; passing this corpus does not close those risks.
