// Exercise the actual source editor, saved work, and paginated preview on both hosts.
export async function sourcePreviewScrollWorkflow(ui) {
  await ui.openWork("E2E document")
  await ui.showSourceMode()
  const original = await ui.readSource()
  const longSource = `# Scroll regression\n\n${Array.from({ length: 70 }, (_, i) => `Paragraph ${i}: ${"long document text ".repeat(8)}\n\n`).join("")}`
  try {
    await ui.replaceSource(longSource)
    await ui.waitForSaved(longSource)
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
