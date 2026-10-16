// Shared keyboard-first vocabulary: every global chord and every command
// palette entry both hosts expose. This module owns the WHAT (action ids,
// labels, descriptions, chords per host, palette membership); hosts own the
// HOW (global keydown handling and native menu accelerators). It is
// dependency-free on purpose: no DOM, no React, no host APIs, so host
// adapters and tests import it directly.
//
// Registry owner, settled from docs/architecture.md authority order
// (doctrine first, then architecture, then code):
// - Doctrine "Your attention is not free" + "A rising floor and a vaulted
//   ceiling" make shortcuts product behavior, not infrastructure.
// - Architecture "Change routing" states: "New editor behavior (a command,
//   palette, or shortcut): packages/client feature slice behind the editor
//   seam; host adapters only mount it."
// - Architecture "Dependency rules" keep `contracts` dependency-free and
//   frozen: a chord/label/palette registry is product UI vocabulary with
//   behavior (matching, display), not a cross-boundary type, so it must not
//   live in contracts.
// Therefore the registry lives here in packages/client, consumed through
// the package entry points. Hosts never define their own chords.

export interface ShortcutKeyEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
}

// Normalized chord form: "cmdOrCtrl+s", "cmdOrCtrl+Enter". Every global
// chord requires the Cmd/Ctrl modifier and never uses Alt or Shift: Vim
// normal mode consumes unmodified keys, so a modified-only vocabulary
// passes Vim through by construction (proven in test, not asserted).
export type ShortcutChord = string;

export interface ShortcutAction {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  // Null means "no direct chord on this host": the action stays reachable
  // through the web command palette (palette: true) or the native menu.
  readonly webChord: ShortcutChord | null;
  readonly desktopChord: ShortcutChord | null;
  // Listed in the web command palette with chord chip + description. The
  // desktop has no palette; its fallback is the native menu bar.
  readonly palette: boolean;
  readonly requiresEditor: boolean;
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = Object.freeze([
  Object.freeze({
    id: "save",
    label: "Save current work",
    description: "Submit the active editor",
    webChord: "cmdOrCtrl+s",
    desktopChord: "cmdOrCtrl+s",
    palette: true,
    requiresEditor: true,
  }),
  Object.freeze({
    id: "open-commands",
    label: "Open command palette",
    description: "Choose an Elef action by name",
    webChord: "cmdOrCtrl+k",
    desktopChord: null,
    palette: false,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "quick-open",
    label: "Search presentations and documents",
    description: "Find by title, alias, heading, or content",
    webChord: "cmdOrCtrl+p",
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "desktop-search-focus",
    label: "Focus library search",
    description: "Jump to the desktop library search field",
    webChord: null,
    desktopChord: "cmdOrCtrl+k",
    palette: false,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "open-work",
    label: "Open work",
    description: "Show the library and focus search",
    webChord: null,
    desktopChord: "cmdOrCtrl+o",
    palette: false,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "new-presentation",
    label: "New presentation",
    description: "Create slide-based Markdown",
    webChord: null,
    desktopChord: "cmdOrCtrl+n",
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    // Owner ruling: palette-only for now, no direct chord. The chord choice
    // stays an explicit residual question (see docs/keyboard-shortcuts.md).
    id: "new-document",
    label: "New document",
    description: "Create a continuous Markdown document",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "present",
    label: "Present work",
    description: "Publish and open the presentation stage",
    webChord: "cmdOrCtrl+Enter",
    desktopChord: "cmdOrCtrl+Enter",
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    // Host difference, deliberate: on the web Cmd+P is quick-open, so print
    // stays palette/button-only there; the desktop menu owns Cmd+P.
    id: "print",
    label: "Print / save PDF",
    description: "Open the print view for the current work",
    webChord: null,
    desktopChord: "cmdOrCtrl+p",
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "download-pptx",
    label: "Download PowerPoint",
    description: "Export the current presentation as .pptx",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "report-bug",
    label: "Report a bug",
    description: "Open the bug report dialog",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "load-samples",
    label: "Load sample works",
    description: "Seed the library with sample documents",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    // Slide structure acts on the overview selection: palette-only (no chord
    // to collide with typing), keyboard-reachable without a Tab marathon.
    id: "slide-add",
    label: "Add slide",
    description: "Add a slide after the selected slide",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: true,
  }),
  Object.freeze({
    id: "slide-duplicate",
    label: "Duplicate slide",
    description: "Duplicate the selected slide",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: true,
  }),
  Object.freeze({
    id: "slide-delete",
    label: "Delete slide",
    description: "Delete the selected slide",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: true,
  }),
  Object.freeze({
    id: "slide-move-up",
    label: "Move slide earlier",
    description: "Move the selected slide earlier",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: true,
  }),
  Object.freeze({
    id: "slide-move-down",
    label: "Move slide later",
    description: "Move the selected slide later",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: true,
  }),
  Object.freeze({
    id: "toggle-vim",
    label: "Toggle Vim mode",
    description: "Change the active editor mode",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: true,
  }),
  Object.freeze({
    id: "toggle-metadata",
    label: "Toggle source metadata",
    description: "Show or hide Markdown front matter",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: true,
  }),
  Object.freeze({
    id: "new-snippet",
    label: "New snippet",
    description: "Create a reusable Markdown snippet",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "change-appearance",
    label: "Change workspace appearance",
    description: "Choose a Theme or Typography default",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "open-settings",
    label: "Open settings",
    description: "Change workspace appearance",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "open-snippets",
    label: "Manage snippets",
    description: "Edit reusable Markdown snippets",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "open-math-shortcuts",
    label: "Manage math shortcuts",
    description: "Edit editor math expansions",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "library-all",
    label: "Open all work",
    description: "Browse documents and presentations",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "library-documents",
    label: "Browse documents",
    description: "Open the document library",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "library-presentations",
    label: "Browse presentations",
    description: "Open the presentation library",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
  Object.freeze({
    id: "vim-settings",
    label: "Open Vim settings",
    description: "Configure browser-local Vim and editor preferences",
    webChord: null,
    desktopChord: null,
    palette: true,
    requiresEditor: false,
  }),
]);

export const PALETTE_ACTION_IDS: readonly string[] = Object.freeze(
  SHORTCUT_ACTIONS.filter((action) => action.palette).map((action) => action.id),
);

export function shortcutById(id: string): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((action) => action.id === id) ?? null;
}

// Browser-reserved chords the web host must never bind: preventDefault on
// these would fight the browser chrome (tabs, windows, reload, find).
// Cmd+S is deliberately NOT reserved: the owner approved preventDefault in
// the editor context, and pages may cancel the save-page dialog.
export const RESERVED_WEB_CHORDS: readonly string[] = Object.freeze([
  "cmdOrCtrl+w",
  "cmdOrCtrl+t",
  "cmdOrCtrl+n",
  "cmdOrCtrl+r",
  "cmdOrCtrl+l",
  "cmdOrCtrl+q",
  "cmdOrCtrl+f",
  "cmdOrCtrl+h",
  "cmdOrCtrl+m",
  "cmdOrCtrl+g",
  "cmdOrCtrl+d",
  "cmdOrCtrl+j",
  "cmdOrCtrl+e",
  "cmdOrCtrl+u",
  "cmdOrCtrl+b",
  "cmdOrCtrl+i",
]);

// Vim-agnostic by design: matching reads only the modifier plus key, never
// editor mode, so a Vim-enabled editor cannot change the outcome. Alt and
// IME compositions never match a global chord.
export function eventMatchesChord(event: ShortcutKeyEvent, chord: ShortcutChord): boolean {
  if (event.isComposing || event.altKey) return false;
  const [modifier, ...rest] = chord.split("+");
  if (modifier !== "cmdOrCtrl" || rest.length === 0) return false;
  const key = rest.join("+");
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return false;
  return event.key.toLowerCase() === key.toLowerCase();
}

const CHORD_KEY_LABELS: Record<string, { mac: string; other: string }> = {
  Enter: { mac: "↵", other: "↵" },
  " ": { mac: "Space", other: "Space" },
  Escape: { mac: "Esc", other: "Esc" },
};

// Display convention, shared by kbd chips, menu accelerators, palette rows,
// and docs: "⌘S" on Mac, "Ctrl+S" elsewhere.
export function chordDisplay(chord: ShortcutChord, platform: "mac" | "other"): string {
  const key = chord.split("+").pop() ?? chord;
  const special = CHORD_KEY_LABELS[key];
  const keyLabel = special !== undefined ? special[platform] : key.toUpperCase();
  return platform === "mac" ? `⌘${keyLabel}` : `Ctrl+${keyLabel}`;
}
