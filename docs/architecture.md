# Architecture

Elef is a Rails application with a Tauri desktop consumer. Rails owns product behavior and all frontend code that can be shared. The desktop packages those Rails-owned sources and adds native filesystem, window, lifecycle, and update adapters.

## System shape

~~~mermaid
flowchart LR
    Browser --> Rails
    Rails --> PG[(PostgreSQL)]
    Rails --> Shared[app/ product UI and JavaScript]
    Tauri[Tauri webview] --> Shared
    Tauri --> Adapter[desktop/frontend/src]
    Adapter --> Commands[Tauri commands]
    Commands --> Core[elef-core]
    Core --> Files[(Deck folders and .elef settings)]
    Tauri -. signed update check .-> Releases[GitHub Releases]
~~~

The dependency direction for frontend sources is one-way:

~~~text
Rails app/ owns shared UI and behavior
              ↓
desktop build consumes app/ sources
              ↓
Tauri adapters and Rust file operations
              ↓
Operating system and user-selected library
~~~

Rails code must not import desktop files or Tauri APIs. The desktop must not duplicate shareable views, styles, controllers, or product workflows. The ownership checker enforces this boundary: [script/check_frontend_ownership.py](../script/check_frontend_ownership.py).

Authored HTML, CSS, and frontend view components belong under `app/`; `desktop/` may not add parallel markup or stylesheets. The desktop packages the Rails-owned static host template and shared styles. Native menus, window chrome, dialogs, and filesystem pickers use Tauri APIs where the platform requires them.

## Product boundaries

| Area | Web app | Desktop app |
|---|---|---|
| Product UI and shared behavior | Rails views, Stimulus, shared JavaScript and styles | Packages and runs the same Rails-owned sources |
| Persistence | Rails models and PostgreSQL; uploaded media uses Active Storage | Markdown deck folders, local assets, manifests, and .elef library settings |
| Runtime integration | Rails routes, sessions, and web browser APIs | Tauri transport, Rust commands, native dialogs/menus, filesystem access, lifecycle, updater |
| Rendering | Shared JavaScript renderer called from Rails through MiniRacer; legacy Ruby renderer remains as an explicit rollback path | The same renderer bundle in a web worker; platform links and media use desktop adapters |

Markdown is the authored source. Rendered HTML, editor projections, library cards, and graph views are derived. Desktop has no database server and does not require Rails to run.

## Code map

| Path | Owns |
|---|---|
| app/controllers, app/models, app/services, app/lib | Rails request handling, persistence, domain services, and server-side integrations |
| app/views, app/javascript, app/assets | Product markup, shared editor/library/graph behavior, controllers, styles, and desktop host template |
| app/lib/source, packages/work-model, packages/renderer | Rails renderer bridge, shared Work semantics, and shared Markdown-to-HTML projection |
| config/routes.rb, config/importmap.rb, db/ | Web routes, frontend pins, and Rails database schema/migrations |
| desktop/crates/elef-core | Tauri-independent deck discovery, manifests, safe writes, media, and .elef archives |
| desktop/src-tauri | Tauri commands, capability boundary, native menu/window integration, and application lifecycle |
| desktop/frontend/src | Tauri bootstrap and native adapters for file-library commands, editor transport, media, lifecycle, and updates |
| test/e2e/scenarios | Rails-owned user flows shared by the Playwright web runner and WebdriverIO Tauri runner |
| test/ | Rails model, service, request, JavaScript, architecture, and browser system tests |
| .github/workflows | CI, desktop release packaging, and deployment automation |

desktop/frontend/build.mjs resolves shared controllers and modules from app/javascript, packages app/views/desktop_host.html and Rails-owned styles, and copies the renderer bundle built by script/build_renderer.mjs. Tauri's configured dev and build hooks use that same frontend build. No Rails server is started by the desktop shell.

The Rails-owned application calls named library services. Tauri command names and raw IPC stay inside `desktop/frontend/src` adapters; Rails-owned frontend code does not invoke Tauri commands.

The desktop media adapter also owns its preview, upload, and deck-asset URL schemes and installs the webview fetch bridge. Shared frontend modules receive those URLs as opaque values; Rails-owned JavaScript does not name desktop protocols or replace `fetch`.

app/views/desktop_host.html is a static desktop host shell consumed by the build, not a Rails response. Shared editor, library, graph, and style behavior lives in Rails-owned application sources.

Both library hosts use the card and action markup from `app/javascript/lib/library_card.js`. Rails supplies its routes and CSRF fields; desktop binds the same controls to local file operations.

## Important contracts

- Deck layout, source selection, manifests, library settings, and archive contents: [desktop data format](desktop/data-format.md).
- Desktop request-to-command mapping and host adapters: [desktop transport](desktop/transport-adapter.md).
- Tauri capabilities, content security policy, path handling, and untrusted content: [desktop security](desktop/security.md).
- Architecture decisions and their status: [desktop ADR index](desktop/adr/README.md).
- Product principles: [Elef Doctrine](../ELEF-DOCTRINE.md).
