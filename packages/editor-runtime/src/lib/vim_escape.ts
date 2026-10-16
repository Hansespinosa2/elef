import { Vim } from "@replit/codemirror-vim"

// Single-Escape dismissal for the inline fuzzy popups.
//
// Every fuzzy popup (snippet `:`/`/`, math-shortcut `@`/`.`, mermaid
// `/diagram`, metadata front-matter, document-link `[[`) listens for Escape in
// the capture phase on the editor DOM, which runs before CodeMirror — and the
// Vim extension — ever sees the keypress. Calling preventDefault() there to
// keep the popup from leaking the key would swallow the very Escape Vim needs
// to leave insert mode, forcing a second Escape press. So the first popup
// that closes on Escape forwards one synthetic Escape to Vim instead, and the
// elefEscapeForwarded flag keeps that forward exactly-once per keypress no
// matter how many popup handlers run.

export interface ElefEscapeEvent extends KeyboardEvent {
  elefEscapeForwarded?: boolean;
}

interface VimCapableEditor {
  readonly vimEnabled?: boolean;
  readonly vim?: unknown;
  readonly insertMode?: boolean;
}

interface PopupRoot {
  querySelectorAll?: (selector: string) => ArrayLike<{ hidden?: boolean }>;
}

type PopupEditor = VimCapableEditor & { readonly element?: PopupRoot | null };

// True when any role="listbox" fuzzy popup inside the editor's element is
// visible. All five popups render as role="listbox" siblings of the editor
// surface (see editor_view.ts), so this stays correct without naming each
// popup controller.
export function editorPopupOpen(editor: PopupEditor | null | undefined): boolean {
  const palettes = editor?.element?.querySelectorAll?.('[role="listbox"]')
  if (!palettes) return false
  for (let index = 0; index < palettes.length; index += 1) {
    if (palettes[index]?.hidden === false) return true
  }
  return false
}

// Forward one Escape to the Vim extension when Vim mode is on and the editor
// is in insert mode. Marks the event so later popup handlers on the same
// keypress close their own popup without forwarding again. Returns true when
// this call performed the forward. Never throws: a browser without the
// optional Vim engine still gets a usable editor.
export function forwardEscapeToVim(editor: VimCapableEditor | null | undefined, event: ElefEscapeEvent): boolean {
  if (event.elefEscapeForwarded) return false
  event.elefEscapeForwarded = true
  try {
    if (!editor?.vimEnabled || !editor.vim || !editor.insertMode) return false
    Vim.handleKey(editor.vim, "<Esc>", "user")
    return true
  } catch (_error) {
    return false
  }
}
