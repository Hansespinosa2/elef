# Architecture

Elef is a Rails application with a Tauri desktop consumer. Shared product behavior lives in `packages/client` (host-neutral UI and feature workflows), `packages/work-model` (pure Work semantics), `packages/renderer` (deterministic projection), and `packages/editor-runtime` (shared Stimulus editor shell); Rails owns web hosting, persistence, and the web host adapters. The desktop packages the shared sources and adds native filesystem, window, lifecycle, and update adapters.

## System shape

~~~mermaid
flowchart LR
    Browser --> Rails
    Rails --> PG[(PostgreSQL)]
    Rails --> Shared[packages/client UI + packages/editor-runtime shell]
    Tauri[Tauri webview] --> Shared
    Tauri --> Adapter[apps/desktop/frontend/src]
    Adapter --> Commands[Tauri commands]
    Commands --> Core[local-store]
    Core --> Files[(Deck folders and .elef settings)]
    Tauri -. signed update check .-> Releases[GitHub Releases]
~~~

The dependency direction for frontend sources is one-way:

~~~text
packages/client (+ work-model/renderer) and packages/editor-runtime own shared UI and behavior
              ↓
apps/desktop build consumes the client bundle + the editor-runtime package
              ↓
Tauri adapters and Rust file operations
              ↓
Operating system and user-selected library
~~~

Rails code must not import desktop files or Tauri APIs, and desktop code must not import Rails-host JavaScript: hosts never import each other. The desktop must not duplicate shareable views, styles, controllers, or product workflows. Host-neutral behavior belongs in `packages/client` (pure semantics in `packages/work-model`), the shared Stimulus editor shell belongs in `packages/editor-runtime`, never in a host. The ownership checker enforces this boundary: [apps/web/script/check_frontend_ownership.py](../apps/web/script/check_frontend_ownership.py).

Web-only pages, host adapters, and shared styles belong under `apps/web/app/`; host-neutral UI and feature workflows belong in `packages/client`. `apps/desktop/` may not add parallel markup or stylesheets. The desktop packages the Rails-owned static host template and shared styles. Native menus, window chrome, dialogs, and filesystem pickers use Tauri APIs where the platform requires them.

## Product boundaries

| Area | Web app | Desktop app |
|---|---|---|
| Product UI and shared behavior | Mounts `packages/client` through the Stimulus HTTP host adapter; web-only pages stay in Rails views | Mounts the same client bundle through the Tauri host adapter |
| Persistence | Rails models and PostgreSQL; uploaded media uses Active Storage | Markdown deck folders, local assets, manifests, and .elef library settings |
| Runtime integration | Rails routes, sessions, and web browser APIs | Tauri transport, Rust commands, native dialogs/menus, filesystem access, lifecycle, updater |
| Rendering | Shared JavaScript renderer called from Rails through MiniRacer; no Ruby renderer remains | The same renderer bundle in a web worker; platform links and media use desktop adapters |

Markdown is the authored source. Rendered HTML, editor projections, library cards, and graph views are derived. Desktop has no database server and does not require Rails to run.

## Code map

| Path | Owns |
|---|---|
| apps/web/app/controllers, apps/web/app/models, apps/web/app/services, apps/web/app/lib | Rails request handling, persistence, domain services, and server-side integrations |
| apps/web/app/views, apps/web/app/javascript, apps/web/app/assets | Web-only pages and shells, thin web host adapters (`controllers/`, `host/`), remaining host-integration modules (`lib/`), shared styles, and desktop host template |
| apps/web/app/lib/source, packages/work-model, packages/renderer | Rails renderer bridge, shared Work semantics, and shared Markdown-to-HTML projection |
| packages/client | Host-neutral interactive UI (React): the sole owner of library, settings, source/visual editor, slide overview, presentation, graph, and export UI, mounted by both hosts via `mountElef` with a host adapter |
| packages/editor-runtime | Shared Stimulus editor shell (controllers, editor `lib`, desktop bootstrap), consumed through its narrowed boot API (`registerEditorRuntime`, `mountEditorHosts`, `startFileLibraryApplication`, mount tokens); strict TypeScript |
| apps/web/config/routes.rb, apps/web/config/importmap.rb, apps/web/db/ | Web routes, frontend pins, and Rails database schema/migrations |
| crates/local-store | Tauri-independent deck discovery, manifests, safe writes, media, and .elef archives |
| apps/desktop/src-tauri | Tauri commands, capability boundary, native menu/window integration, and application lifecycle |
| apps/desktop/frontend/src | Tauri bootstrap and native adapters for file-library commands, editor transport, media, lifecycle, and updates |
| apps/web/test/e2e/scenarios | Rails-owned user flows shared by the Playwright web runner and WebdriverIO Tauri runner |
| apps/web/test/ | Rails model, service, request, JavaScript, architecture, and browser system tests |
| .github/workflows | CI, desktop release packaging, and deployment automation |

apps/desktop/frontend/build.mjs resolves `@elef/editor-runtime` (and the `@elef/client` bundle) as workspace packages, packages apps/web/app/views/desktop_host.html and Rails-owned styles, and copies the renderer bundle built by packages/renderer/build.mjs. Tauri's configured dev and build hooks use that same frontend build. No Rails server is started by the desktop shell.

The Rails-owned application calls named library services. Tauri command names and raw IPC stay inside `apps/desktop/frontend/src` adapters; Rails-owned frontend code does not invoke Tauri commands.

The desktop media adapter also owns its preview, upload, and deck-asset URL schemes and installs the webview fetch bridge. Shared frontend modules receive those URLs as opaque values; Rails-owned JavaScript does not name desktop protocols or replace `fetch`.

apps/web/app/views/desktop_host.html is a static desktop host shell consumed by the build, not a Rails response. Shared editor, library, and graph behavior lives in `packages/client`; shared styles live in Rails-owned `apps/web/app/assets`.

Both hosts mount the same `packages/client` bundle for library, settings, and editor UI: Rails through a Stimulus controller with the HTTP host adapter, desktop through `packages/editor-runtime/src/lib/file_library_application.ts` with the Tauri host adapter. Host differences (routes vs in-app views, native dialogs, server templates) ride the documented mount seams; the client carries no host knowledge (boundary R9).

## Packages

Each package exists for exactly one reason; anything else is a module inside its owner.

| Package | One-sentence justification |
|---|---|
| packages/contracts | Single frozen vocabulary both hosts and every package import, so cross-boundary names cannot drift. |
| packages/work-model | Single pure implementation of Work semantics, so structure rules never fork between hosts. |
| packages/renderer | Single deterministic Markdown-to-HTML projection, so both hosts render identical output. |
| packages/client | Single host-neutral interactive UI mounted by both hosts, so product workflows are written once. |
| packages/editor-runtime | Single shared Stimulus editor shell consumed through one boot API, so neither host keeps editor controllers. |
| crates/local-store | Single Tauri-independent deck-storage core, so desktop persistence is testable without the native shell. |

`apps/desktop/frontend` and `apps/desktop/e2e` carry a `package.json` as host-owned build/test tooling with one consumer each; they are not architectural packages and need no justification.

## Dependency rules

These hold everywhere and are machine-checked (`tooling/check_boundaries.py`, `apps/web/script/check_frontend_ownership.py`):

- imports point one way: contracts ← client, work-model ← renderer ← client ← editor-runtime ← hosts (editor-runtime additionally imports work-model directly); the single reviewed exception is the renderer → editor-runtime editor-chrome seam (pinned by R12); nothing else imports upward;
- `contracts` is dependency-free and frozen; `work-model` is pure (no DOM, no I/O, no host);
- `local-store` never touches Tauri; Tauri commands stay inside `apps/desktop/frontend/src` adapters;
- Rails code never imports desktop files or Tauri APIs; desktop code never imports Rails-host JavaScript; the desktop never duplicates shareable views, styles, controllers, or workflows;
- no package reaches into another package's internals (public entry points only);
- Work syntax is interpreted exactly once, in `work-model` (rule R8);
- `editor-runtime` is a narrowed boot API: packages never import it except the renderer seam `editor-chrome`, and no importer names a subpath beyond its exports (rule R12);
- TypeScript lives in packages only: host JavaScript stays thin glue, typed at the seams through contracts ports and package APIs. Host code that grows real logic moves to its owning package instead of being converted in place;
- source writes are atomic with fingerprint checks; see the [desktop data format](desktop/data-format.md) and [ADR-008](desktop/adr/008-safe-writes-and-conflict-detection.md).

## State ownership

Each mutable state has exactly one owner; anything else reads it through that owner.

| State | Owner |
|---|---|
| Work semantics and structure | `packages/work-model` |
| Projection and derived HTML | `packages/renderer` |
| Cursor, selection, undo | the editor (client feature slice) |
| Navigation and current work | `packages/client` application shell |
| Save lifecycle and conflict flow | `WorkSession` (`packages/client/src/session`) |
| Web persistence, auth, sessions | Rails + PostgreSQL (`apps/web`) |
| Local persistence, history, archives | `crates/local-store` + filesystem |
| Native lifecycle, updater, windows | desktop host (`apps/desktop`) |

## Change routing

Ask "which row owns the state or behavior?" and put the change there; add a host adapter only when a concrete platform capability differs.

- **New Work syntax** (a directive, position rule, or boundary): `packages/work-model` (semantics + tests), `packages/renderer` (projection), both hosts inherit; never in a host or a host adapter.
- **New editor behavior** (a command, palette, or shortcut): `packages/client` feature slice behind the editor seam; the web Stimulus adapter and the Tauri adapter only mount it.
- **New native capability** (a dialog, menu, or filesystem picker): `apps/desktop/frontend/src` adapter + Tauri command, capability-declared; the client receives values, never Tauri APIs.
- **Web-only page or admin surface**: `apps/web/app/` (controller + view); shared styling only from `apps/web/app/assets`.

## Important contracts

- Deck layout, source selection, manifests, library settings, and archive contents: [desktop data format](desktop/data-format.md).
- Persisted-format version rules, archive layout, and the deck manifest schema with frozen fixtures: [spec/](../spec/version-rules.md).
- Desktop request-to-command mapping and host adapters: [desktop transport](desktop/transport-adapter.md).
- Tauri capabilities, content security policy, path handling, and untrusted content: [desktop security](desktop/security.md).
- Architecture decisions and their status: [desktop ADR index](desktop/adr/README.md).
- Product principles: [Elef Doctrine](../ELEF-DOCTRINE.md).
