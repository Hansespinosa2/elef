// A projection with no live visual editor (the source-only Stable profile
// registers neither visual-editor nor the presentation editor) must never
// expose editable blocks: installed HTML always carries contenteditable
// shells, and without a manager no edit could propagate back to source.
// Mirrors the source-mode end state of syncProjectionEditability.
export function markProjectionBlocksReadOnly(projection: Element | null | undefined): void {
  if (!projection?.querySelectorAll) return
  projection.querySelectorAll("[data-editor-block-id]").forEach((block) => {
    setProjectionBlockEditable(block, false, "")
  })
}

export function setProjectionBlockEditable(block: Element, editable: boolean, ariaLabel: string): void {
  setAttribute(block, "contenteditable", String(editable))

  if (editable) {
    setAttribute(block, "role", "textbox")
    setAttribute(block, "aria-label", ariaLabel)
    setAttribute(block, "aria-multiline", "true")
    setAttribute(block, "spellcheck", "true")
    removeAttribute(block, "aria-readonly")
  } else {
    removeAttribute(block, "role")
    removeAttribute(block, "aria-label")
    removeAttribute(block, "aria-multiline")
    removeAttribute(block, "spellcheck")
    setAttribute(block, "aria-readonly", "true")
  }
}

function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value)
}

function removeAttribute(element: Element, name: string): void {
  if (element.hasAttribute(name)) element.removeAttribute(name)
}
