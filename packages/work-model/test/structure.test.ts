import assert from "node:assert/strict"
import test from "node:test"

import {
  buildEditorMap,
  buildEditorStructure,
  initialFrontMatter,
  POSITION_VOCABULARY,
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
  const first = editorMap.slides[0]
  const second = editorMap.slides[1]
  assert.ok(first)
  assert.ok(second)
  assert.equal(first.id, "slide-1")
  assert.ok(first.delimiter_range)
  assert.deepEqual(source.slice(first.delimiter_range.start, first.delimiter_range.end), "---\n")
  assert.deepEqual(second.delimiter_range, null)
  assert.equal(source.slice(second.range.start, second.range.end).trim(), "# Two\n\n```\n---\n```")
})

test("document mode keeps one slide over the whole body", () => {
  const source = "---\ntheme: dark\n---\n\n# Doc\n\n---\n\nMore\n"
  const { slides, editorMap } = buildEditorStructure(source, { mode: "document", sourceName: "Doc" })
  assert.equal(slides.length, 1)
  assert.equal(editorMap.mode, "document")
  assert.equal(editorMap.source_name, "Doc")
  assert.equal(editorMap.source_length, source.length)
  assert.deepEqual(editorMap.slides[0]?.delimiter_range, null)
})

test("front matter reports body start and feeds style", () => {
  const source = "---\ntheme: dark\ntypography: modern\n---\n\n# Hi\n"
  const front = initialFrontMatter(source)
  assert.ok(front)
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
  const slide = editorMap.slides[0]
  assert.ok(slide)
  const blocks = slide.blocks.filter(block => !block.empty_placeholder)
  assert.ok(blocks.length >= 3)
  for (const block of blocks) {
    assert.equal(typeof block.range.start, "number")
    assert.ok(block.range.start >= 0 && block.range.end <= source.length)
    assert.ok(source.slice(block.range.start, block.range.end).includes(block.markdown.split("\n")[0] ?? ""))
    assert.deepEqual(block.source_range, block.range)
  }
})

test("position directives attach to the following block", () => {
  const source = ":::align{center}\n\n# Placed\n"
  const { editorMap } = buildEditorStructure(source, { mode: "presentation" })
  assert.ok(editorMap.directives.length >= 1)
  const slide = editorMap.slides[0]
  assert.ok(slide)
  const placed = slide.blocks.find(block => block.markdown.includes("# Placed"))
  assert.ok(placed)
  assert.equal(placed.position?.horizontal, "center")
})

test("position vocabulary is the canonical align grammar", () => {
  assert.deepEqual(POSITION_VOCABULARY, {
    horizontal: ["left", "center", "right"],
    vertical: ["top", "middle", "bottom"]
  })
  const { editorMap } = buildEditorStructure(":::align{bottom right}\n\n# Placed\n", { mode: "presentation" })
  const placed = editorMap.slides[0]?.blocks.find(block => block.markdown.includes("# Placed"))
  assert.equal(placed?.position?.horizontal, "right")
  assert.equal(placed?.position?.vertical, "bottom")
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

test("position directive binds to exactly the single next block and bare ::: does not extend scope", () => {
  const source = "# Slide\n\n:::align{center}\n\nFirst\n\nSecond\n\n:::\n\nOutside"
  const map = buildEditorMap(source, { mode: "presentation" })
  const slide = map.slides[0]
  assert.ok(slide)
  const blocks = slide.blocks

  assert.equal(blocks.length, 4)
  assert.equal(blocks[0]?.markdown, "# Slide")
  assert.equal(blocks[0]?.position, null)
  assert.equal(blocks[1]?.markdown, "First")
  assert.deepEqual(blocks[1]?.position, { horizontal: "center", vertical: "top", vertical_explicit: false })
  assert.equal(blocks[2]?.markdown, "Second")
  assert.equal(blocks[2]?.position, null)
  assert.equal(blocks[3]?.markdown, "Outside")
  assert.equal(blocks[3]?.position, null)
  assert.equal(blocks[1]?.position_directive_id, slide.directives[0]?.id)
  assert.equal(blocks[2]?.position_directive_id, null)

  const structure = buildEditorStructure(source, { mode: "presentation" })
  assert.ok(structure.warnings.includes("Unknown or malformed presentation directive was removed."))
})

test("bare ::: alone is typed as unknown directive and warns without affecting positioning", () => {
  const source = "# Slide\n\n:::\n\nFirst"
  const structure = buildEditorStructure(source, { mode: "presentation" })
  const map = structure.editorMap
  const slide = map.slides[0]
  assert.ok(slide)

  assert.equal(slide.directives[0]?.type, "unknown")
  assert.equal(slide.blocks[1]?.position, null)
  assert.deepEqual(structure.warnings, ["Unknown or malformed presentation directive was removed."])
})

test("display math with trailing closers does not swallow following blocks", () => {
  const source = [
    "### D1",
    "",
    "Lead paragraph.",
    "",
    "$$\\begin{aligned}",
    "x &= 1 \\\\",
    "y &= 2",
    "\\end{aligned}$$",
    "",
    "### D2",
    "",
    "Tail paragraph.",
    ""
  ].join("\n")
  const { editorMap } = buildEditorStructure(source, { mode: "document" })
  const slide = editorMap.slides[0]
  assert.ok(slide)
  const blocks = slide.blocks.filter(block => !block.empty_placeholder)
  const markdowns = blocks.map(block => block.markdown)
  assert.ok(markdowns.some(markdown => markdown.startsWith("### D1")))
  assert.ok(markdowns.some(markdown => markdown.startsWith("### D2")))
  assert.ok(markdowns.some(markdown => markdown.startsWith("Tail paragraph.")))
  assert.ok(blocks.every(block => block.range.end - block.range.start < source.length))
})

test("escaped dollars do not close display math fences", () => {
  const source = [
    "$$",
    "x = 1 \\$$",
    "y = 2",
    "$$",
    "",
    "Tail.",
    ""
  ].join("\n")
  const { editorMap } = buildEditorStructure(source, { mode: "document" })
  const slide = editorMap.slides[0]
  assert.ok(slide)
  const blocks = slide.blocks.filter(block => !block.empty_placeholder)
  assert.ok(blocks.some(block => block.markdown.startsWith("Tail.")))
  assert.equal(blocks.filter(block => block.markdown.includes("Tail.")).length, 1)
})

test("display math fences do not swallow presentation slide delimiters", () => {
  const source = [
    "# One",
    "",
    "$$\\begin{aligned}",
    "x &= 1",
    "\\end{aligned}$$",
    "",
    "---",
    "",
    "# Two",
    ""
  ].join("\n")
  const { slides } = buildEditorStructure(source, { mode: "presentation" })
  assert.equal(slides.length, 2)
})

test("consecutive non-blank lines group into a single block for alignment and stepping", () => {
  const source = [
    "# Grouped Slide",
    "",
    ":::align{middle center}",
    ":::step{1}",
    "## Fitzgerald",
    "American novelist",
    "- The Great Gatsby",
    "- Tender Is the Night",
    "",
    "Separate paragraph"
  ].join("\n")
  const structure = buildEditorStructure(source, { mode: "presentation" })
  const slide = structure.slides[0]
  const mapSlide = structure.editorMap.slides[0]
  assert.ok(slide)
  assert.ok(mapSlide)

  assert.equal(slide.blocks.length, 3)
  assert.equal(slide.blocks[1]?.markdown, "## Fitzgerald\nAmerican novelist\n- The Great Gatsby\n- Tender Is the Night")
  assert.deepEqual(slide.blocks[1]?.position, { horizontal: "center", vertical: "middle", vertical_explicit: true })
  assert.equal(slide.blocks[1]?.reveal_event, 0)
  assert.equal(slide.blocks[2]?.markdown, "Separate paragraph")
  assert.equal(slide.blocks[2]?.position, null)
  assert.equal(slide.blocks[2]?.reveal_event, undefined)

  assert.equal(mapSlide.blocks.length, 3)
  assert.equal(mapSlide.blocks[1]?.markdown, "## Fitzgerald\nAmerican novelist\n- The Great Gatsby\n- Tender Is the Night")
  assert.deepEqual(mapSlide.blocks[1]?.position, { horizontal: "center", vertical: "middle", vertical_explicit: true })
  assert.equal(mapSlide.blocks[1]?.reveal_event, 0)
  // Multi-construct grouped blocks are non-editable in visual mode to prevent lossy inline round-tripping.
  assert.equal(mapSlide.editable_regions[1]?.editable, false)
  assert.equal(mapSlide.editable_regions[1]?.role, "block")
  assert.notEqual(mapSlide.editable_regions[1]?.kind, "heading")
  assert.equal(mapSlide.editable_regions[2]?.editable, true)
})

test("document mode preserves construct boundaries for visual editing while presentation mode groups", () => {
  const headings = "# One\n# Two\n# Three"
  const docHeadings = buildEditorStructure(headings, { mode: "document" })
  assert.equal(docHeadings.editorMap.slides[0]?.blocks.length, 3)
  assert.deepEqual(
    docHeadings.editorMap.slides[0]?.editable_regions.map(region => [region.kind, region.editable]),
    [["heading", true], ["heading", true], ["heading", true]]
  )

  const mixed = "## Fitzgerald\nAmerican novelist\n- The Great Gatsby"
  const docMixed = buildEditorStructure(mixed, { mode: "document" })
  assert.equal(docMixed.editorMap.slides[0]?.blocks.map(block => block.markdown).length, 3)
  assert.deepEqual(
    docMixed.editorMap.slides[0]?.editable_regions.map(region => region.editable),
    [true, true, true]
  )

  const artThematic = ":::art\n- Alpha\n- Beta\n***\nAfter"
  const docArt = buildEditorStructure(artThematic, { mode: "document" })
  assert.deepEqual(docArt.slides[0]?.blocks.map(block => block.markdown), ["- Alpha\n- Beta", "***", "After"])
  const presArt = buildEditorStructure(artThematic, { mode: "presentation" })
  assert.deepEqual(presArt.slides[0]?.blocks.map(block => block.markdown), ["- Alpha\n- Beta", "***\nAfter"])

  const adjacentMathAndCode = "Intro\n$$\nx^2\n$$\nMiddle\n```js\nconst y = 1\n```\nOutro"
  const docSplit = buildEditorStructure(adjacentMathAndCode, { mode: "document" })
  assert.deepEqual(docSplit.slides[0]?.blocks.map(block => block.markdown), [
    "Intro",
    "$$\nx^2\n$$",
    "Middle",
    "```js\nconst y = 1\n```",
    "Outro"
  ])
  const presGrouped = buildEditorStructure(adjacentMathAndCode, { mode: "presentation" })
  assert.equal(presGrouped.slides[0]?.blocks.length, 1)
  assert.equal(presGrouped.editorMap.slides[0]?.editable_regions[0]?.editable, false)
})

test("multi-line heading groups do not leak into slide titles or column headings and setext headings stay read-only", () => {
  const mixedTitleSource = "# Slide Title\nBody paragraph\n\n## Col 1\n\nLeft\n\n## Col 2\n\nRight"
  const mixedTitle = buildEditorStructure(mixedTitleSource, { mode: "presentation" })
  assert.equal(mixedTitle.slides[0]?.layout, "body")
  assert.equal(mixedTitle.slides[0]?.title, null)
  assert.equal(mixedTitle.editorMap.slides[0]?.editable_regions[0]?.role, "block")
  assert.notEqual(mixedTitle.editorMap.slides[0]?.editable_regions[0]?.kind, "heading")
  assert.equal(mixedTitle.editorMap.slides[0]?.editable_regions[0]?.editable, false)

  const twoColGroupedBody = "# Two Column\n\n## Col 1\n\nFirst line\nSecond line\n\n## Col 2\n\nRight"
  const twoCol = buildEditorStructure(twoColGroupedBody, { mode: "presentation" })
  assert.equal(twoCol.slides[0]?.layout, "two-column")
  assert.equal(twoCol.slides[0]?.title, "# Two Column")
  assert.equal(twoCol.slides[0]?.regions[0]?.[1]?.markdown, "First line\nSecond line")
  assert.equal(twoCol.editorMap.slides[0]?.editable_regions[2]?.editable, true)

  for (const setext of ["Heading\n===", "Paragraph\nHeading\n===", "Paragraph\nHeading\n----", "Heading\n=", "Heading\n-"]) {
    for (const mode of ["document", "presentation"] as const) {
      const result = buildEditorStructure(setext, { mode })
      assert.equal(result.editorMap.slides[0]?.editable_regions[0]?.editable, false, `${mode}: ${JSON.stringify(setext)}`)
    }
  }
  const docTripleDashSetext = buildEditorStructure("Paragraph\nHeading\n---", { mode: "document" })
  assert.equal(docTripleDashSetext.editorMap.slides[0]?.editable_regions[0]?.editable, false)

  const mathBlock = "$$\na\n=\nb\n$$"
  const mathStructure = buildEditorStructure(mathBlock, { mode: "document" })
  assert.equal(mathStructure.editorMap.slides[0]?.editable_regions[0]?.editable, true)
})

