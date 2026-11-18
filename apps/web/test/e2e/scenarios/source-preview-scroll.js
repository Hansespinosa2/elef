// Exercise the actual source editor, saved work, and paginated preview on both hosts.
export async function measureSourceSelectionAlignment() {
  const field = document.querySelector(".source-field")
  const view = field?.editorController?.view
  if (!view) throw new Error("Source editor is unavailable")
  view.focus()
  view.dispatch({ selection: { anchor: view.state.doc.line(5).to, head: 0 }, scrollIntoView: true })
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const line = view.contentDOM.querySelectorAll(".cm-line")[2]
  const text = line?.firstChild
  if (!text) throw new Error("Source selection fixture is not visible")
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 1)
  const textRect = range.getBoundingClientRect()
  const selection = [...view.dom.querySelectorAll(".cm-selectionBackground")]
    .map(element => element.getBoundingClientRect())
    .find(rect => rect.top <= textRect.top + 1 && rect.bottom >= textRect.bottom - 1)
  if (!selection) throw new Error("Multiline selection was not drawn")
  return { textLeft: textRect.left, selectionLeft: selection.left }
}

export async function sourcePreviewScrollWorkflow(ui) {
  await ui.openWork("E2E document")
  await ui.showSourceMode()
  const original = await ui.readSource()
  const longSource = `# Scroll regression\n\n${Array.from({ length: 70 }, (_, i) => `Paragraph ${i}: ${"long document text ".repeat(8)}\n\n`).join("")}`
  try {
    await ui.replaceSource(longSource)
    await ui.waitForSaved(longSource)
    await ui.assertSourceSelectionAlignment()
    await ui.waitForScrollPreview("Paragraph 69")
    const before = await ui.scrollPreviewToBottom()
    if (before < 200) throw new Error(`Preview did not scroll deeply: ${before}`)
    const edited = `${longSource}Saved scroll marker.\n`
    await ui.replaceSource(edited)
    await ui.waitForSaved(edited)
    await ui.waitForScrollPreview("Saved scroll marker.")
    const after = await ui.previewScrollTop()
    if (Math.abs(before - after) > 120) throw new Error(`Preview jumped after save: ${before} -> ${after}`)
  } finally {
    await ui.replaceSource(original)
    await ui.waitForSaved(original)
  }
}
