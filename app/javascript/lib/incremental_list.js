export const LIBRARY_RENDER_BATCH_SIZE = 48

export function createIncrementalList(container, { batchSize = LIBRARY_RENDER_BATCH_SIZE } = {}) {
  if (!container?.ownerDocument) throw new TypeError("An incremental list needs a DOM container")
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new TypeError("List batch size must be a positive integer")

  let values = []
  let renderItem = null
  let onAppend = () => {}
  let index = 0

  function render(items, createItem, options = {}) {
    if (typeof createItem !== "function") throw new TypeError("List items need a renderer")
    values = Array.from(items)
    renderItem = createItem
    onAppend = options.onAppend || (() => {})
    index = 0
    container.replaceChildren()
    appendNext()
    return values.length
  }

  function appendNext() {
    if (!renderItem || index >= values.length) return false

    const fragment = container.ownerDocument.createDocumentFragment()
    const appended = []
    const end = Math.min(index + batchSize, values.length)
    for (; index < end; index += 1) {
      const node = renderItem(values[index], index)
      if (!node) continue
      fragment.append(node)
      appended.push(node)
    }
    container.append(fragment)
    if (appended.length) onAppend(appended)
    return index < values.length
  }

  return {
    render,
    appendNext,
    get hasMore() { return index < values.length },
    get renderedCount() { return index }
  }
}
