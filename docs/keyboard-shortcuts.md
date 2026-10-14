# Keyboard shortcuts

How every Elef action is reachable without a mouse: the shared chord
registry, the command palette, and the per-host differences. The registry
itself lives in `packages/client/src/features/shortcuts/shortcuts.ts` —
this file is the human-readable map, not a second source of truth.

Enforced by: `packages/client/test/shortcuts.test.ts` (uniqueness,
reserved-chord collision, palette completeness, Vim pass-through),
`apps/web/test/javascript/keyboard_shortcuts.test.mjs` (web chords, desktop
dispatch, palette rows), `apps/web/test/controllers/library_controller_test.rb`
(palette lists every registry action), `apps/desktop/src-tauri/src/menus.rs`
menu-id uniqueness.

## Registry owner

Shortcuts live in `packages/client`, not `packages/contracts`, settled from
the architecture authority order (doctrine → architecture → code):

- Doctrine ("Your attention is not free", "A rising floor and a vaulted
  ceiling") makes keyboard reach a product behavior, not infrastructure.
- Architecture change routing is explicit: "New editor behavior (a command,
  palette, or shortcut): `packages/client` feature slice behind the editor
  seam; the web Stimulus adapter and the Tauri adapter only mount it."
- Architecture dependency rules keep `contracts` dependency-free and frozen:
  a chord/label/palette registry carries behavior (matching, display), not
  just cross-boundary types, so it must not live there.

Hosts never define their own chords; they mount the registry (web Stimulus
global keydown, desktop webview keydown + native menu accelerators).

## Final shortcut map

`⌘` = Cmd on Mac, `Ctrl` elsewhere. "Palette" = listed in the web command
palette (`⌘K`) with description + chord chip; the desktop has no palette and
falls back to its native menu bar.

| Action | Web | Desktop | Palette |
|---|---|---|---|
| Save current work | `⌘S` (new; prevents browser save dialog in editor context) | `⌘S` (menu, pre-existing) | yes |
| Add / duplicate / delete slide, move slide earlier / later | palette-only (ride the overview buttons for the selected slide) | n/a (web-only editor chrome) | yes |
| Open command palette | `⌘K` (pre-existing) | — (menu bar instead) | — (it is the palette) |
| Search presentations and documents | `⌘P` (pre-existing) | — | yes |
| Focus library search | — | `⌘K` (pre-existing webview handler) | no (Open Work menu covers it) |
| Open work | — | `⌘O` (menu, pre-existing) | no (native menu) |
| New presentation | — (palette-only) | `⌘N` (menu, pre-existing) | yes |
| New document | — (palette-only, owner ruling) | — (menu item, no chord) | yes |
| Present work | `⌘↵` (new; publish + open stage) | `⌘↵` (new; webview-level, all platforms) | yes |
| Print / save PDF | — (palette/button; `⌘P` is search on web) | `⌘P` (menu, pre-existing) | yes |
| Download PowerPoint | — (palette/button) | — (menu item, no chord) | yes |
| Report a bug | — (palette) | n/a (no desktop control) | yes |
| Load sample works | — (palette) | n/a (no desktop control) | yes |
| Toggle Vim mode | — (palette) | — (menu/settings, no chord) | yes |
| Toggle source metadata | — (palette) | — (no chord) | yes |
| New snippet, appearance, settings pages, library views, Vim settings | — (palette) | n/a or menu | yes |

Nothing is mouse-only: every on-screen control is reachable by direct chord,
palette entry, native-menu accelerator, or plain Tab (`button`/`a`/`select`
elements stay native). Browser-reserved chords (`⌘W/T/N/R/L/Q/F/...`) are
never bound on the web; `⌘S` is the one deliberate exception, owner-approved
for the editor context only (elsewhere the browser default is untouched).

## Display convention

One convention everywhere — kbd chips, menu accelerators, palette rows, and
this doc: `⌘S` on Mac, `Ctrl+S` elsewhere; Enter renders as `↵` (`⌘↵` /
`Ctrl+↵`). A palette row shows label + description + chord chip; icon-only
buttons show icon + chip (when chorded) with full `aria-label`/`title`.

## Icon choices (trial, to-be-judged visually)

Print, PPTX download, and Present in the work shell are icon-only: 24×24
`stroke-width 1.7` SVG following the new-work menu precedent
(`_new_work_menu.html.erb`). Present reuses the library-card play glyph
(circle + triangle); download is an arrow into a tray; print is a printer
(rects). No text label; screen readers get `aria-label` + `sr-only` text.
Flagged in the PR as needing human visual judgment.

## Vim proof

Every global chord requires Cmd/Ctrl by construction, and Vim normal mode
consumes only unmodified keys — verified, not asserted, in
`@replit/codemirror-vim-core/vim.js` (`vimKeyFromEvent` maps Cmd to the `M-`
prefix; unmapped `<M-…>` sequences return falsy from `handleKey`, so no
`stopPropagation`) and in `editor_controller.ts` (its keydown listeners never
stop propagation for modified keys). Tests prove each registry chord matches
with Vim enabled, the web adapter fires each chord through a faithful
Vim-like interceptor, and present-mode travel ignores modified keys so
`⌘↵` never double-acts as slide advance. Fallback is structural anyway: save
and present are both palette-listed, and desktop chords all sit on native
menu items (search-focus falls back to the Open Work menu).

## Host differences (deliberate)

- `⌘P`: web = quick-open; desktop = Print. Each host keeps its pre-existing
  binding; the registry records both, and uniqueness is enforced per host.
- `⌘K`: web = command palette; desktop = focus library search.
- Present `⌘↵`: web = Stimulus global keydown; desktop = webview keydown
  (not a native accelerator, so macOS/Linux/Windows behave identically).
- Show Library vs Open Work (desktop): separate menu ids since the
  duplicate-id fix; Open Work (`⌘O`) shows the library and focuses search,
  Show Library just shows it.

## Resolved questions

- Web `⌘S`: yes — preventDefault in editor context, wired to Save.
- New Document chord: palette-only for now, no direct chord (owner ruling).
- Icon-only Print/PPTX/Present/Download: trial, flagged for visual judgment.
- Show-Library duplicate menu id (`open-work` × 2): fixed with its own
  regression test; behavior split documented above.

## Residual question

Which direct chord, if any, should New Document get? Candidates collide
(`⌘N` is New Presentation on desktop and new-window in browsers; `⌘⇧N`,
`⌘D` are free on desktop but `⌘D` bookmarks on web). Left palette-only
until the owner picks.
