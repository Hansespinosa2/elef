// Shared Vim normal-mode caret indicator for the visual passage. Source
// mode shows CodeMirror's fat cursor; the rendered text carries a native
// line caret, so normal mode paints an out-of-flow block tint over the
// character under the caret. The overlay is viewport-positioned and
// pointer-transparent: it never changes content geometry and never
// intercepts input. Visual (ranged) selections paint natively instead,
// and insert mode keeps the plain line caret.
export interface VimCaretEditor {
  readonly vimEnabled: boolean
  readonly insertMode: boolean
  readonly selectionStart: number
  readonly selectionEnd: number
}

const CARET_CLASS = "elef-vim-normal-caret"

// No direct DOM-global references (instanceof HTMLElement, document,
// window): unit tests run in node without them. Capability checks bail
// out where the DOM is absent.
interface CaretOverlay {
  style: { display: string; left: string; top: string; width: string; height: string }
}

function existingOverlay(root: Element): CaretOverlay | null {
  if (!root || typeof root.querySelector !== "function") return null
  const existing = root.querySelector(`:scope > .${CARET_CLASS}`) as unknown as
    { nodeType?: number; style?: CaretOverlay["style"] } | null
  if (existing?.nodeType !== 1 || !existing.style) return null
  return existing as CaretOverlay
}

function caretOverlay(root: Element): CaretOverlay | null {
  const found = existingOverlay(root)
  if (found) return found
  const owner = root.ownerDocument as unknown as
    { createElement?: (tag: string) => unknown } | null | undefined
  if (typeof owner?.createElement !== "function" || typeof (root as unknown as { appendChild?: unknown }).appendChild !== "function") return null
  const overlay = owner.createElement("div") as unknown as
    { className?: string; setAttribute?: (name: string, value: string) => void; style?: CaretOverlay["style"] }
  if (!overlay?.style) return null
  overlay.className = CARET_CLASS
  overlay.setAttribute?.("aria-hidden", "true")
  ;(root as unknown as { appendChild: (node: unknown) => void }).appendChild(overlay)
  return overlay as CaretOverlay
}

function hideOverlay(root: Element): void {
  const overlay = existingOverlay(root)
  if (overlay) overlay.style.display = "none"
}

export function updateVimNormalCaret(
  root: Element,
  editor: VimCaretEditor | null | undefined,
  projection: Element | null | undefined,
  isVisual: boolean
): void {
  // Normal mode only: insert keeps the line caret, visual paints the
  // native range, and source mode owns its own fat cursor.
  if (!root || !editor?.vimEnabled || editor.insertMode || editor.selectionStart !== editor.selectionEnd || !isVisual) {
    hideOverlay(root)
    return
  }
  const selection = root.ownerDocument?.getSelection?.() ?? null
  const focusNode = selection?.focusNode ?? null
  if (!selection?.isCollapsed || !focusNode || !projection) {
    hideOverlay(root)
    return
  }
  const host = focusNode.nodeType === 1 ? (focusNode as Element) : (focusNode as ChildNode).parentElement
  const block = host?.closest?.("[data-editor-block-id]")
  if (!block || !projection.contains(block) || (block as HTMLElement).contentEditable !== "true") {
    hideOverlay(root)
    return
  }
  // The character under a normal-mode caret; at end of text Vim sits on
  // the last character, so the tint does too.
  if (focusNode.nodeType !== 3) {
    hideOverlay(root)
    return
  }
  const text = (focusNode as Text).data ?? ""
  const caret = selection.focusOffset
  const from = caret < text.length ? caret : text.length - 1
  if (from < 0) {
    hideOverlay(root)
    return
  }
  const range = root.ownerDocument?.createRange?.() as unknown as
    { setStart?: (node: Node, offset: number) => void; setEnd?: (node: Node, offset: number) => void; getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } } | null | undefined
  if (!range || typeof range.setStart !== "function" || typeof range.setEnd !== "function" || typeof range.getBoundingClientRect !== "function") {
    hideOverlay(root)
    return
  }
  try {
    range.setStart(focusNode, from)
    range.setEnd(focusNode, from + 1)
  } catch {
    hideOverlay(root)
    return
  }
  const rect = range.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    hideOverlay(root)
    return
  }
  const overlay = caretOverlay(root)
  if (!overlay) return
  overlay.style.display = "block"
  overlay.style.left = `${rect.left}px`
  overlay.style.top = `${rect.top}px`
  overlay.style.width = `${rect.width}px`
  overlay.style.height = `${rect.height}px`
}
