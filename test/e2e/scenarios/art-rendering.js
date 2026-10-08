import assert from "node:assert/strict"

// ART-PARITY-SEMANTICS: exercise shared source, mode, item order, and nested list semantics in both products.
// ART-SRC-008: the position modifier before Art must remain attached to the same root list in both products.
export const ART_PARITY_SOURCE = `# Peer parity

:::position{middle right}
:::art
- Research
  1. Interview users
  2. Review evidence
- Design

---

# Sequence parity

:::art
3. Discover
   - Interview users
4. Launch
`

export async function artRenderingWorkflow(ui) {
  await ui.openDeck()
  const originalSource = await ui.readSource()

  try {
    await ui.replaceSource(ART_PARITY_SOURCE)
    await ui.waitForSaved(ART_PARITY_SOURCE)
    await ui.refreshPreview()
    await ui.showVisualMode()
    await ui.waitForArtRoots(2)

    const roots = await ui.readArtSemantics()
    assert.deepEqual(roots.map(root => ({
      mode: root.mode,
      density: root.density,
      rootTag: root.rootTag,
      itemCount: root.itemCount,
      itemText: root.itemText,
      nestedListTag: root.nestedListTag,
      start: root.start
    })), [
      {
        mode: "peers",
        density: "rich",
        rootTag: "UL",
        itemCount: 2,
        itemText: ["Research Interview users Review evidence", "Design"],
        nestedListTag: "OL",
        start: null
      },
      {
        mode: "sequence",
        density: "rich",
        rootTag: "OL",
        itemCount: 2,
        itemText: ["Discover Interview users", "Launch"],
        nestedListTag: "UL",
        start: "3"
      }
    ])
    assert.match(roots[0].blockClass, /position-right/)
    assert.match(roots[0].blockClass, /position-middle/)
    assert.equal(roots.every(root => ["ready", "pending", "fallback-unsupported", "fallback-no-fit", "error"].includes(root.status)), true)
    assert.equal(roots.every(root => ["peers-wrap", "sequence-horizontal", "sequence-vertical", "plain-list"].includes(root.layout)), true)
  } finally {
    await ui.replaceSource(originalSource)
    await ui.waitForSaved(originalSource)
    await ui.refreshPreview()
    await ui.showVisualMode()
  }
}
