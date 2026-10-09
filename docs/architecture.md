# Architecture

Elef is a Rails application with a Tauri desktop consumer. Shared product behavior lives in `packages/client` (host-neutral UI and feature workflows), `packages/work-model` (pure Work semantics), and `packages/renderer` (deterministic projection); Rails owns web hosting, persistence, and the web host adapters. The desktop packages the shared sources and adds native filesystem, window, lifecycle, and update adapters.

## System shape

~~~mermaid
flowchart LR
    Browser --> Rails
    Rails --> PG[(PostgreSQL)]
    Rails --> Shared[packages/client UI + shared apps/web/app/javascript]
    Tauri[Tauri webview] --> Shared
    Tauri --> Adapter[apps/desktop/frontend/src]
    Adapter --> Commands[Tauri commands]
    Commands --> Core[local-store]
    Core --> Files[(Deck folders and .elef settings)]
    Tauri -. signed update check .-> Releases[GitHub Releases]
~~~

The dependency direction for frontend sources is one-way:

~~~text
packages/client (+ work-model/renderer) owns shared UI and behavior
              ↓
apps/desktop build consumes the client bundle + shared apps/web/app/javascript modules
              ↓
Tauri adapters and Rust file operations
              ↓
Operating system and user-selected library
~~~

Rails code must not import desktop files or Tauri APIs. The desktop must not duplicate shareable views, styles, controllers, or product workflows. Host-neutral behavior belongs in `packages/client` (pure semantics in `packages/work-model`), never in a host. The ownership checker enforces this boundary: [apps/web/script/check_frontend_ownership.py](../apps/web/script/check_frontend_ownership.py).

Web-only pages, host adapters, and shared styles belong under `apps/web/app/`; host-neutral UI and feature workflows belong in `packages/client`. `apps/desktop/` may not add parallel markup or stylesheets. The desktop packages the Rails-owned static host template and shared styles. Native menus, window chrome, dialogs, and filesystem pickers use Tauri APIs where the platform requires them.

## Product boundaries

| Area | Web app | Desktop app |
|---|---|---|
| Product UI and shared behavior | Mounts `packages/client` through the Stimulus HTTP host adapter; web-only pages stay in Rails views | Mounts the same client bundle through the Tauri host adapter |
| Persistence | Rails models and PostgreSQL; uploaded media uses Active Storage | Markdown deck folders, local assets, manifests, and .elef library settings |
| Runtime integration | Rails routes, sessions, and web browser APIs | Tauri transport, Rust commands, native dialogs/menus, filesystem access, lifecycle, updater |
| Rendering | Shared JavaScript renderer called from Rails through MiniRacer; legacy Ruby renderer remains as an explicit rollback path | The same renderer bundle in a web worker; platform links and media use desktop adapters |

Markdown is the authored source. Rendered HTML, editor projections, library cards, and graph views are derived. Desktop has no database server and does not require Rails to run.

## Code map

| Path | Owns |
|---|---|
| apps/web/app/controllers, apps/web/app/models, apps/web/app/services, apps/web/app/lib | Rails request handling, persistence, domain services, and server-side integrations |
| apps/web/app/views, apps/web/app/javascript, apps/web/app/assets | Web-only pages and shells, web host adapters (`controllers/`, `host/`), shared host-integration modules (`lib/`), shared styles, and desktop host template |
| apps/web/app/lib/source, packages/work-model, packages/renderer | Rails renderer bridge, shared Work semantics, and shared Markdown-to-HTML projection |
| packages/client | Host-neutral interactive UI (React): the sole owner of library, settings, source/visual editor, slide overview, presentation, graph, and export UI, mounted by both hosts via `mountElef` with a host adapter |
| apps/web/config/routes.rb, apps/web/config/importmap.rb, apps/web/db/ | Web routes, frontend pins, and Rails database schema/migrations |
| crates/local-store | Tauri-independent deck discovery, manifests, safe writes, media, and .elef archives |
| apps/desktop/src-tauri | Tauri commands, capability boundary, native menu/window integration, and application lifecycle |
| apps/desktop/frontend/src | Tauri bootstrap and native adapters for file-library commands, editor transport, media, lifecycle, and updates |
| apps/web/test/e2e/scenarios | Rails-owned user flows shared by the Playwright web runner and WebdriverIO Tauri runner |
| apps/web/test/ | Rails model, service, request, JavaScript, architecture, and browser system tests |
| .github/workflows | CI, desktop release packaging, and deployment automation |

apps/desktop/frontend/build.mjs resolves shared controllers and modules from apps/web/app/javascript (shared modules import the `@elef/client` bundle), packages apps/web/app/views/desktop_host.html and Rails-owned styles, and copies the renderer bundle built by apps/web/script/build_renderer.mjs. Tauri's configured dev and build hooks use that same frontend build. No Rails server is started by the desktop shell.

The Rails-owned application calls named library services. Tauri command names and raw IPC stay inside `apps/desktop/frontend/src` adapters; Rails-owned frontend code does not invoke Tauri commands.

The desktop media adapter also owns its preview, upload, and deck-asset URL schemes and installs the webview fetch bridge. Shared frontend modules receive those URLs as opaque values; Rails-owned JavaScript does not name desktop protocols or replace `fetch`.

apps/web/app/views/desktop_host.html is a static desktop host shell consumed by the build, not a Rails response. Shared editor, library, and graph behavior lives in `packages/client`; shared styles live in Rails-owned `apps/web/app/assets`.

Both hosts mount the same `packages/client` bundle for library, settings, and editor UI: Rails through a Stimulus controller with the HTTP host adapter, desktop through `file_library_application.js` with the Tauri host adapter. Host differences (routes vs in-app views, native dialogs, server templates) ride the documented mount seams; the client carries no host knowledge (boundary R9).

## Important contracts

- Deck layout, source selection, manifests, library settings, and archive contents: [desktop data format](desktop/data-format.md).
- Desktop request-to-command mapping and host adapters: [desktop transport](desktop/transport-adapter.md).
- Tauri capabilities, content security policy, path handling, and untrusted content: [desktop security](desktop/security.md).
- Architecture decisions and their status: [desktop ADR index](desktop/adr/README.md).
- Product principles: [Elef Doctrine](../ELEF-DOCTRINE.md).
