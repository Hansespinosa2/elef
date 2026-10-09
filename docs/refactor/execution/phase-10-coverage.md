# Phase 10 coverage map (P10-01 / P10-02)

Every contract-listed area maps to shared scenario module(s) executed by both
real-host runners (`desktop/e2e/specs/web.spec.js` via Playwright against
Rails, `desktop/e2e/specs/desktop.spec.js` via wdio against the Tauri binary).
`script/check_frontend_ownership.py` (`shared_workflows` set) machine-enforces
that both runners import and execute every shared workflow; the web runner is
CI-gated, the desktop runner is locally runnable (`npm test --prefix
desktop/e2e` under dbus+xvfb+openbox).

## Area → modules → execution

| Area (P10-01) | Shared module(s) | Web execution | Desktop execution |
|---|---|---|---|
| library | library-and-graph, library-create-delete, library-deep-links | web.spec.js shared library flows | desktop.spec.js shared library flows |
| create | library-create-delete (`createWork`) | WebLibraryUi | DesktopLibraryUi |
| open | edit-and-preview (`openDeck`), library-create-delete (`assertCreatedWork`: web.spec.js:719, desktop.spec.js:1264) | WebEditorUi/WebLibraryUi | DesktopEditorUi/DesktopLibraryUi |
| rename | library-and-graph (`renameWork`: web.spec.js:806, desktop.spec.js:1402), edit-and-preview (`renameEditorTitle`) | both UI classes | both UI classes |
| delete | library-create-delete (`deleteWork`) | WebLibraryUi | DesktopLibraryUi |
| source/visual editing | edit-and-preview, authoring-palettes, vim-relative-line-numbers | shared editing flows | shared editing flows |
| preview | edit-and-preview | shared editing flow | shared editing flow |
| presentation | presentation-mode | shared presentation flow | shared presentation flow |
| graph | library-and-graph | shared library+graph flow | shared library+graph flow |
| authoring | authoring-palettes, authoring-settings | shared authoring flows | shared authoring flows |
| media | media-fixture, insert-image (nested via edit-and-preview) | shared media flows | shared media flows |
| settings | authoring-settings, appearance | shared settings flows | shared settings flows |
| save/conflict/recovery | external-edit-conflict, undo-redo-session (nested via edit-and-preview); quiet-save.spec.js (desktop local save, 13 tests); Rails system tests (web save) | external-edit-conflict + system suite | external-edit-conflict + quiet-save suite |
| supported export | export.js: web branch runs client `features/export` → download → status; desktop branch asserts the explicit disabled path (HD-06) | "shared export flow downloads PPTX in the web app" | "asserts the explicit export-disabled path in the desktop binary" |

## Capability-disabled limbs (P10-02)

| Disabled behavior | Asserting test |
|---|---|
| updater absent on web | "the web app without an updater capability shows no updater affordance" |
| nativeMenus absent on web (in-DOM menus) | "the web app without a nativeMenus capability renders menus in-DOM" |
| localFilesystem absent on web (no folder picker) | "the web app without a localFilesystem capability offers no library folder picker" |
| export absent on desktop | desktop branch of `exportWorkflow` |
| programmatic delete on desktop | `tauriPolicy.deleteProgrammatic: false` + conformance skip-declaration assertion |

No gaps found: every P10-01 area resolves to at least one shared module with
both-runner execution, and every known disabled limb has an explicit
assertion. Byte-level export contracts stay in the Rails export tests
(`test/services/presentations/pptx_export_test.rb`,
`test/system/pptx_export_test.rb`, `test/system/media_pdf_export_test.rb`).
