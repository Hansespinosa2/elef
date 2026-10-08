import assert from "node:assert/strict"
import test from "node:test"

import {
  buildEditorMap,
  buildEditorStructure,
  initialFrontMatter,
  readStyle
} from "../src/index.js"

test("structure rejects non-string sources and unknown modes", () => {
  assert.throws(() => buildEditorStructure(null), TypeError)
  assert.throws(() => buildEditorStructure("# Hi", { mode: "spreadsheet" }), TypeError)
  assert.throws(() => buildEditorMap(42), TypeError)
})

test("structure splits presentation slides on thematic breaks outside fences", () => {
  const source = "# One\n\n---\n\n# Two\n\n```\n---\n```\n"
  const { slides, editorMap } = buildEditorStructure(source, { mode: "presentation" })
  assert.equal(slides.length, 2)
  assert.equal(editorMap.slides.length, 2)
  assert.equal(editorMap.slides[0].id, "slide-1")
  assert.deepEqual(source.slice(editorMap.slides[0].delimiter_range.start, editorMap.slides[0].delimiter_range.end), "---\n")
  assert.deepEqual(editorMap.slides[1].delimiter_range, null)
  assert.equal(source.slice(editorMap.slides[1].range.start, editorMap.slides[1].range.end).trim(), "# Two\n\n```\n---\n```")
})

test("document mode keeps one slide over the whole body", () => {
  const source = "---\ntheme: dark\n---\n\n# Doc\n\n---\n\nMore\n"
  const { slides, editorMap } = buildEditorStructure(source, { mode: "document", sourceName: "Doc" })
  assert.equal(slides.length, 1)
  assert.equal(editorMap.mode, "document")
  assert.equal(editorMap.source_name, "Doc")
  assert.equal(editorMap.source_length, source.length)
  assert.deepEqual(editorMap.slides[0].delimiter_range, null)
})

test("front matter reports body start and feeds style", () => {
  const source = "---\ntheme: dark\ntypography: modern\n---\n\n# Hi\n"
  const front = initialFrontMatter(source)
  assert.equal(source.slice(front.bodyStart), "\n# Hi\n")
  assert.deepEqual(readStyle(source), { theme: "dark", typography: "modern" })
  assert.equal(initialFrontMatter("# No fence\n"), null)
  assert.equal(initialFrontMatter("---\nnot metadata\n"), null)
  assert.deepEqual(readStyle("# Plain\n"), { theme: "match", typography: "book" })
})

test("readStyle ignores unknown values and strips quotes and comments", () => {
  assert.deepEqual(readStyle("---\ntheme: neon\n---\n"), { theme: "match", typography: "book" })
  assert.deepEqual(readStyle("---\ntheme: \"dark\" # night\n---\n"), { theme: "dark", typography: "book" })
})

test("blocks carry source ranges that slice the original bytes", () => {
  const source = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n"
  const { editorMap } = buildEditorStructure(source, { mode: "document" })
  const blocks = editorMap.slides[0].blocks.filter(block => !block.empty_placeholder)
  assert.ok(blocks.length >= 3)
  for (const block of blocks) {
    assert.equal(typeof block.range.start, "number")
    assert.ok(block.range.start >= 0 && block.range.end <= source.length)
    assert.ok(source.slice(block.range.start, block.range.end).includes(block.markdown.split("\n")[0]))
    assert.deepEqual(block.source_range, block.range)
  }
})

test("position directives attach to the following block", () => {
  const source = ":::align{center}\n\n# Placed\n"
  const { editorMap } = buildEditorStructure(source, { mode: "presentation" })
  assert.ok(editorMap.directives.length >= 1)
  const placed = editorMap.slides[0].blocks.find(block => block.markdown.includes("# Placed"))
  assert.ok(placed)
  assert.equal(placed.position?.horizontal, "center")
})

test("margin settings default on and read show-in-margin overrides", () => {
  const plain = buildEditorStructure("# Hi\n", { mode: "presentation" })
  assert.deepEqual(plain.marginSettings, { section: true, subsection: true, footnote: true, slide_count: true })
  const toggled = buildEditorStructure("---\nshow-in-margin:\n  slide-count: false\n---\n\n# Hi\n", { mode: "presentation" })
  assert.equal(toggled.marginSettings.slide_count, false)
  assert.equal(toggled.marginSettings.section, true)
})

test("CRLF sources keep byte-faithful ranges", () => {
  const source = "# One\r\n\r\n---\r\n\r\n# Two\r\n"
  const { editorMap } = buildEditorStructure(source, { mode: "presentation" })
  assert.equal(editorMap.slides.length, 2)
  for (const slide of editorMap.slides) {
    assert.ok(slide.range.start >= 0 && slide.range.end <= source.length)
  }
})

test("buildEditorMap returns the map subset of the structure", () => {
  const map = buildEditorMap("# Hi\n", { mode: "document" })
  assert.equal(map.version, 1)
  assert.ok(Array.isArray(map.slides))
  assert.ok(Array.isArray(map.editable_regions))
})
