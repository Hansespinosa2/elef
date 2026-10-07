# Desktop integration boundary

Rails app/ owns the shared product workflows and user interface. Desktop packages those sources and provides native services at the boundary. The desktop does not boot Rails or reproduce Rails persistence.

## Flow

1. The shared application starts from app/javascript/lib/file_library_application.js.
2. The web host supplies Rails routes and browser persistence. The desktop entry point in desktop/frontend/src/main.js injects named file-library services and Tauri lifecycle services.
3. Shared Stimulus controllers and modules call the same fetch-shaped interfaces in both hosts.
4. Desktop adapters translate the relevant requests to named Tauri commands, a local rendering worker, or the asset protocol.
5. Rust commands validate arguments and delegate filesystem operations to desktop/crates/elef-core.
6. Shared workflows and scenarios remain in Rails-owned source and desktop/e2e/scenarios.

The shared application never calls raw Tauri `invoke()` or names Rust commands. `desktop/frontend/src/file-library-transport.js` maps file-library operations to commands; editor saves, media, updater, and lifecycle stay in their corresponding desktop adapters.

Desktop frontend edits belong in desktop/frontend/src only when they implement a native transport, lifecycle, window, media, close, or updater integration. If behavior can be expressed independently of Tauri, put it under app/ and make both hosts consume it.

## Handler categories

| Work | Desktop implementation | Boundary |
|---|---|---|
| Library, deck, manifest, save, archive, and portable-settings operations | Tauri commands backed by elef-core | Named commands and typed errors |
| Markdown preview and editor projection | Shared renderer in a web worker | Local to the webview; no Rust IPC round trip |
| Media upload and reads | Native upload command and deck-scoped asset protocol | Content-addressed writes and validated, read-only reads |
| Save conflict handling | Shared save flow plus desktop fingerprint adapter | The adapter supplies the base content hash; shared UI presents resolution |
| Library cards, filters, graph, editor, settings UI | Rails-owned app/ modules | No desktop-only copy |

The command and capability allowlists are checked by [the architecture checker](../../desktop/scripts/check_architecture.py). The complete user-flow parity harness and test commands are in [development and testing](../development.md).

## Error and save contract

Tauri command failures cross the boundary as typed errors with a stable code and a user-safe message. The frontend maps them to expected fetch response shapes; raw operating-system errors are not shown directly.

Before saving, desktop sends the content hash captured at load or after the last successful save. A mismatch returns a conflict and preserves the local buffer for resolution. A successful write updates the adapter's base hash. Save ordering, recovery behavior, and the documented race are specified in [ADR-008](adr/008-safe-writes-and-conflict-detection.md).
