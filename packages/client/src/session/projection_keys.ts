// Shared visual-projection key routing. Documents and presentations execute
// identical key behavior by delegating here: Vim owns unmodified keys in
// normal mode, and modified shortcuts plus Tab run through the engine's own
// keymap — the same command implementations source mode uses. Plain caret
// keys stay native so screen-dependent movement resolves against the visible
// layout, and Enter/Backspace/Delete stay with the visual structural
// handlers. This mirrors source precedence exactly (the Vim plugin handles
// keys before keymaps in the engine extension order), so visual key behavior
// cannot drift from source behavior.
import { vimPassthroughKey } from "./projection_input.js"

export interface ProjectionKeyEventLike {
  readonly key: string
  readonly isComposing: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  preventDefault(): void
}

export interface ProjectionKeyEditor {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly selectionHead: number
  readonly vimEnabled: boolean
  readonly insertMode: boolean
  setSelectionRange(anchor: number, head?: number): void
  handleVimKey(event: ProjectionKeyEventLike): boolean
  runKeymap(event: ProjectionKeyEventLike): boolean
}

export interface ProjectionKeyHost {
  editorController: ProjectionKeyEditor | null | undefined
  pendingProjectionEdits: { readonly size: number } | null | undefined
  pendingCaretRestore: { sourceOffset: number; preferredBlockId: string | null } | null | undefined
  flushPendingProjectionEdits(): void
  restoreCaret(sourceOffset: number, preferredBlockId: string | null): boolean
}

function hasModifier(event: ProjectionKeyEventLike): boolean {
  return event.altKey || event.ctrlKey || event.metaKey
}

// Ctrl/Command-C must reach the browser even when the Vim layer would
// consume it: the engine mirrors the extension's copy yield by letting this
// key fall through to native copy (the post-copy selection collapse the
// extension performs stays engine-side until the clipboard bridge lands).
function isClipboardCopy(event: ProjectionKeyEventLike): boolean {
  if (event.altKey || event.shiftKey || event.key.toLowerCase() !== "c") return false
  return (event.ctrlKey ? 1 : 0) + (event.metaKey ? 1 : 0) === 1
}

// Shortcuts whose UI anchors to the hidden engine surface stay native until
// the completion/popup bridge lands: the find panel, find-next (which opens
// the panel when no query exists), the goto-line dialog, and completion
// start. Native find-in-page over the rendered Work is the better interim.
function isPanelAnchored(event: ProjectionKeyEventLike): boolean {
  if (!event.ctrlKey && !event.metaKey) return false
  if (event.key === " " && event.ctrlKey && !event.metaKey && !event.altKey) return true
  const key = event.key.toLowerCase()
  if (key !== "f" && key !== "g") return false
  if (key === "g" && event.altKey && !event.shiftKey) return true
  return !event.altKey
}

// Occurrence selection would strand a ranged engine selection with no native
// counterpart, and falling through opens the browser bookmark dialog.
// Swallow it: the caret follows the command head instead. Ranged outcomes
// from every other command restore the prior selection and keep native
// behavior (select-all over the block, italic via the legacy path).
function swallowsRangedOutcome(event: ProjectionKeyEventLike): boolean {
  return !event.altKey && (event.ctrlKey !== event.metaKey) && !event.shiftKey
    && event.key.toLowerCase() === "d"
}

function afterProjectionEngineKey(
  host: ProjectionKeyHost,
  editor: ProjectionKeyEditor,
  blockElement: Element,
  valueBefore: string,
): void {
  const head = editor.selectionHead
  const blockId = (blockElement as HTMLElement).dataset.editorBlockId ?? null
  host.restoreCaret(head, blockId)
  if (editor.value !== valueBefore) {
    host.pendingCaretRestore = { sourceOffset: head, preferredBlockId: blockId }
    blockElement.dispatchEvent(new Event("input", { bubbles: true }))
  }
}

// Routes visual-mode keys through the live Vim machinery when Vim is active
// outside insert mode (plus Escape, which leaves insert mode, and modified
// keys, which Vim sees first exactly as in source mode). Handled keys
// preventDefault; the native caret follows the engine head synchronously,
// and source-changing commands schedule a projection refresh with caret
// restoration. Plain keys Vim declines are swallowed except
// navigation/focus keys, which keep native behavior; declined modified keys
// fall through to the shared keymap below. Returns true when Vim owned the
// key and no further handling should run.
//
// Neither router stops propagation: no window-level chord (command palette,
// desktop menu) overlaps an engine-consumed key, and CodeMirror itself only
// preventDefaults keymap-handled keys.
export function routeProjectionVimKey(
  host: ProjectionKeyHost,
  event: ProjectionKeyEventLike,
  blockElement: Element,
): boolean {
  const editor = host.editorController
  if (!editor || !editor.vimEnabled) return false
  if ((blockElement as HTMLElement).contentEditable !== "true") return false
  if (event.isComposing || isClipboardCopy(event)) return false
  const modified = hasModifier(event)
  if (editor.insertMode && event.key !== "Escape" && !modified) return false
  if (host.pendingProjectionEdits?.size) host.flushPendingProjectionEdits()
  const valueBefore = editor.value
  if (!editor.handleVimKey(event)) {
    if (modified || vimPassthroughKey(event.key)) return false
    event.preventDefault()
    return true
  }
  event.preventDefault()
  afterProjectionEngineKey(host, editor, blockElement, valueBefore)
  return true
}

// Routes modified shortcuts and Tab through the engine's registered keymap —
// history, word/line motion, deletion, and structural commands — so visual mode
// executes the same implementations as source mode. Native undo/redo in
// particular must never run against projection content. Plain keys,
// Alt-only combinations (word motion, word deletion, and composed
// characters, all correct natively), and panel-anchored shortcuts keep
// native behavior. Returns true when the keymap owned the key.
export function routeProjectionKeymapKey(
  host: ProjectionKeyHost,
  event: ProjectionKeyEventLike,
  blockElement: Element,
): boolean {
  const editor = host.editorController
  if (!editor) return false
  if ((blockElement as HTMLElement).contentEditable !== "true") return false
  if (event.isComposing) return false
  const modified = hasModifier(event)
  if (!modified && event.key !== "Tab") return false
  if (event.altKey && !event.ctrlKey && !event.metaKey) return false
  if (isPanelAnchored(event)) return false
  if (host.pendingProjectionEdits?.size) host.flushPendingProjectionEdits()
  const valueBefore = editor.value
  const headBefore = editor.selectionHead
  const anchorBefore = headBefore === editor.selectionEnd ? editor.selectionStart : editor.selectionEnd
  if (!editor.runKeymap(event)) return false
  if (editor.selectionStart !== editor.selectionEnd) {
    if (swallowsRangedOutcome(event)) {
      event.preventDefault()
      const head = editor.selectionHead
      editor.setSelectionRange(head, head)
      afterProjectionEngineKey(host, editor, blockElement, valueBefore)
      return true
    }
    editor.setSelectionRange(anchorBefore, headBefore)
    return false
  }
  event.preventDefault()
  afterProjectionEngineKey(host, editor, blockElement, valueBefore)
  return true
}
