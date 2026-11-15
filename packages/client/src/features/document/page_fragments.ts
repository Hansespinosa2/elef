// Join page fragments without turning a continued list item or quote
// paragraph into a second logical child. Both pagination and editing use
// this operation so a visual page boundary cannot change Markdown structure.
export function appendPageFragment(target: Element, fragment: Element): void {
  for (const node of [...fragment.childNodes]) {
    const previous = target.lastElementChild
    if (node instanceof Element && node.hasAttribute("data-document-page-continuation") &&
        previous && previous.tagName === node.tagName) {
      appendPageFragment(previous, node)
    } else {
      const copy = node.cloneNode(true)
      if (copy instanceof Element) copy.removeAttribute("data-document-page-continuation")
      target.append(copy)
    }
  }
}
