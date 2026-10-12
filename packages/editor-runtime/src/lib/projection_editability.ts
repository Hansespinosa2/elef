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
