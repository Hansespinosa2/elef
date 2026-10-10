import assert from "node:assert/strict"
import test from "node:test"
import { performance } from "node:perf_hooks"
import { buildEditorStructure } from "../src/index.js"

test("ART-ARCH-SHARED-MAP: Art source ownership and loose-list block mapping share one binding", () => {
  const source = ":::art\r\n:::align{center}\r\n- Lead\r\n\r\n  Body\r\n- Second"
  const structure = buildEditorStructure(source, { mode: "document" })
  const slide = structure.editorMap.slides[0]

  assert.equal(slide?.blocks.length, 1)
  assert.equal(slide?.blocks[0]?.markdown, "- Lead\r\n\r\n  Body\r\n- Second")
  assert.deepEqual(slide?.blocks[0]?.art, {
    directive_id: slide?.directives.find((directive) => directive.type === "art")?.id,
    source_range: { start: 0, end: 8 }
  })
  assert.equal(slide?.blocks[0]?.position?.horizontal, "center")
  assert.equal(slide?.directives.find((directive) => directive.type === "art")?.source_range.end, 8)
  assert.deepEqual(slide?.art_diagnostics || [], [])
})

test("ART-SRC-005: content after the target root list remains a separate Markdown block", () => {
  const source = "# Keep\n\nBefore\n\n:::art\n- Alpha\n- Beta\n\nAfter\n\nTail"
  const slide = buildEditorStructure(source, { mode: "presentation" }).editorMap.slides[0]

  assert.deepEqual(slide?.blocks.map((block) => block.markdown), [
    "# Keep",
    "Before",
    "- Alpha\n- Beta",
    "After",
    "Tail"
  ])
  assert.deepEqual(slide?.blocks[2]?.art?.source_range, { start: 16, end: 23 })
})

test("ART-EDIT-ORPHAN: Art stays unbound after a barrier and cannot jump to a later list", () => {
  const structure = buildEditorStructure(":::art\nA paragraph.\n\n- Later", { mode: "document" })
  assert.equal(structure.editorMap.slides[0]?.blocks.length, 2)
  assert.ok(structure.editorMap.slides[0]?.blocks.every((block) => !block.art))
  assert.deepEqual(structure.editorMap.art_diagnostics?.map((diagnostic) => diagnostic.code), ["ART_NO_LIST_TARGET"])
})

test("Art source mapping stays responsive across thousands of Markdown blocks and targets", () => {
  const parts: Array<string> = []
  for (let index = 0; index < 6000; index += 1) {
    parts.push(`Paragraph ${index}.`)
    if (index % 6 === 0) parts.push(`:::art\n- Item ${index}`)
  }
  const source = parts.join("\n\n")
  const startedAt = performance.now()
  const structure = buildEditorStructure(source, { mode: "document" })
  const elapsed = performance.now() - startedAt
  const blocks = structure.editorMap.slides[0]?.blocks ?? []

  assert.equal(blocks.length, 7000)
  assert.equal(blocks.filter((block) => block.art).length, 1000)
  assert.ok(elapsed < 1500, `mapping 6000 paragraphs and 1000 Art lists took ${Math.round(elapsed)}ms`)
})
