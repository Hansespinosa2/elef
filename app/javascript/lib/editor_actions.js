// Shared host seam for neutral client behavior contracts: elements bearing
// `data-editor-action="<action>"` are dispatched natively instead of through
// Stimulus action strings, so both hosts bind the same contracts. Handlers
// receive the native event plus the resolved control element (the Stimulus
// `currentTarget` equivalent).
export function editorActionControl(event, action) {
  const control = event.target?.closest?.(`[data-editor-action="${action}"]`)
  return control ?? null
}

export function bindEditorAction(root, action, handler, { events = ["click"] } = {}) {
  const listener = (event) => {
    const control = editorActionControl(event, action)
    if (!control || !root.contains(control)) return
    handler(event, control)
  }
  events.forEach((type) => root.addEventListener(type, listener))
  return () => events.forEach((type) => root.removeEventListener(type, listener))
}
