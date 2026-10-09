import test from "node:test"
import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import { parseHTML } from "linkedom"
import { analyzeArtList, resolveArtBindings } from "../../app/javascript/lib/art_source.js"
import { buildEditorStructure } from "../../app/javascript/lib/document_map.js"
import { renderPreview } from "../../app/javascript/lib/renderer.js"

const bindingCases = [
  { id: "ART-BIND-EXACT", source: ":::art\n- A\n- B", binding: true, mode: "peers", items: 2 },
  { id: "ART-BIND-CRLF", source: ":::art\r\n- A\r\n- B", binding: true, mode: "peers", items: 2 },
  { id: "ART-BIND-TRAILING-WHITESPACE", source: ":::art \t\n- A\n- B", binding: true, mode: "peers", items: 2 },
  { id: "ART-BIND-EOF-NO-TARGET", source: ":::art", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-INVALID-BRACES", source: ":::art{flow}\n- A", binding: false, diagnostic: "ART_INVALID_SYNTAX" },
  { id: "ART-BIND-INVALID-ARGUMENT", source: ":::art extra\n- A", binding: false, diagnostic: "ART_INVALID_SYNTAX" },
  { id: "ART-BIND-ARTIST", source: ":::artist\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-ARTICLE", source: ":::article\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-LEADING-SPACE", source: " :::art\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-BACKTICK-FENCE", source: "```md\n:::art\n```\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-TILDE-FENCE", source: "~~~md\n:::art\n~~~\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-FOUR-BACKTICK-FENCE", source: "````md\n```\n:::art\n```\n````\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-DISPLAY-MATH", source: "$$\n:::art\n$$\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-BLOCKQUOTE", source: "> :::art\n> - A", binding: false, diagnostic: null },
  { id: "ART-BIND-INDENTED-LIST", source: "- parent\n  :::art\n  - nested", binding: false, diagnostic: null },
  { id: "ART-BIND-INDENTED-CODE", source: "    :::art\n    - nested", binding: false, diagnostic: null },
  { id: "ART-BIND-ORDERED-PERIOD", source: ":::art\n1. A\n2. B", binding: true, mode: "sequence", start: 1, items: 2 },
  { id: "ART-BIND-ORDERED-PAREN", source: ":::art\n1) A\n2) B", binding: true, mode: "sequence", start: 1, items: 2 },
  { id: "ART-BIND-ORDERED-ZERO", source: ":::art\n0. A\n1. B", binding: true, mode: "sequence", start: 0, items: 2 },
  { id: "ART-BIND-ORDERED-THREE", source: ":::art\n3. A\n4. B", binding: true, mode: "sequence", start: 3, items: 2 },
  { id: "ART-BIND-ALIGN-AFTER", source: ":::art\n:::align{center}\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-POSITION-AFTER", source: ":::art\n:::position{middle right}\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-ALIGN-BEFORE", source: ":::align{center}\n:::art\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-POSITION-BEFORE", source: ":::position{middle right}\n:::art\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-CLOSING-BARRIER", source: ":::art\n:::\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-FENCED-CODE-BARRIER", source: ":::art\n```js\nconst value = 1\n```\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-DISPLAY-MATH-BARRIER", source: ":::art\n$$\nx^2\n$$\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-HEADING-BARRIER", source: ":::art\n# Heading\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-TABLE-BARRIER", source: ":::art\n| A |\n|---|\n| B |\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-UNKNOWN-DIRECTIVE", source: ":::art\n:::unknown{value}\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-SUPERSEDED", source: ":::art\n:::art\n- A", binding: true, mode: "peers", items: 1, diagnostics: ["ART_NO_LIST_TARGET"] },
  { id: "ART-BIND-PARAGRAPH-BARRIER", source: ":::art\nParagraph.\n\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-ART-IN-PARAGRAPH", source: "Paragraph\n:::art\n- A", binding: false, diagnostic: null }
]

for (const fixture of bindingCases) {
  test(`${fixture.id}: Art source binding`, () => {
    const resolved = resolveArtBindings(fixture.source)
    assert.equal(resolved.bindings.length, fixture.binding ? 1 : 0)
    if (fixture.binding) {
      const [binding] = resolved.bindings
      assert.equal(binding.analysis.mode, fixture.mode)
      assert.equal(binding.analysis.itemCount, fixture.items)
      if (fixture.start !== undefined) assert.equal(binding.analysis.orderedStart, fixture.start)
    }
    const codes = resolved.diagnostics.map(diagnostic => diagnostic.code)
    if (fixture.diagnostics) assert.deepEqual(codes, fixture.diagnostics)
    else if (fixture.diagnostic) assert.deepEqual(codes, [fixture.diagnostic])
    else assert.deepEqual(codes, [])
  })
}

test("ART-SEM-ROOT-COUNT: nested lists retain native meaning without becoming Art items", () => {
  const analysis = analyzeArtList([
    "1. Research",
    "   - Interview users",
    "   - Review competitors",
    "     1. Enterprise",
    "     2. Consumer",
    "2. Design",
    "   1. Prototype",
    "   2. Validate"
  ].join("\n"))

  assert.deepEqual(analysis && {
    mode: analysis.mode,
    density: analysis.density,
    itemCount: analysis.itemCount,
    orderedStart: analysis.orderedStart
  }, { mode: "sequence", density: "rich", itemCount: 2, orderedStart: 1 })
})

test("ART-SEM-UNSUPPORTED: image and unsupported block content select whole-list fallback", () => {
  for (const markdown of ["- A\n  ![image](image.png)", "- A\n\n  ```js\n  code\n  ```", "- A\n\n  | a |\n  |---|\n  | b |"])
    assert.equal(analyzeArtList(markdown)?.supported, false)
})

test("ART-SEM-EMPTY: empty root items remain counted and compact", () => {
  const analysis = analyzeArtList("-\n- Filled")
  assert.equal(analysis?.itemCount, 2)
  assert.equal(analysis?.density, "compact")
})

test("ART-REVEAL-BOUNDARY: SmartArt crossing reveal groups falls back to complete Markdown", () => {
  const source = "# Split Art\n\n:::step{1}\n:::art\n- first\n\n:::step{2}\n- second"
  const resolution = resolveArtBindings(source)
  const preview = renderPreview({ source })
  const { document } = parseHTML(`<html><body>${preview.html}</body></html>`)

  assert.equal(resolution.bindings.length, 0)
  assert.deepEqual(resolution.diagnostics.map(diagnostic => diagnostic.code), ["ART_REVEAL_BOUNDARY"])
  assert.ok(preview.warnings.some(warning => warning.includes("split the Art list or remove the step marker")))
  assert.equal(document.querySelectorAll(".elef-art").length, 0)
  assert.deepEqual([...document.querySelectorAll(".slide-block")].map(block => block.textContent.trim()), ["Split Art", "first", "second"])
})

test("ART-ARCH-SHARED-MAP: Art source ownership and loose-list block mapping share one binding", () => {
  const source = ":::art\r\n:::align{center}\r\n- Lead\r\n\r\n  Body\r\n- Second"
  const structure = buildEditorStructure(source, { mode: "document" })
  const slide = structure.editorMap.slides[0]

  assert.equal(slide.blocks.length, 1)
  assert.equal(slide.blocks[0].markdown, "- Lead\r\n\r\n  Body\r\n- Second")
  assert.deepEqual(slide.blocks[0].art, {
    directive_id: slide.directives.find(directive => directive.type === "art").id,
    source_range: { start: 0, end: 8 }
  })
  assert.equal(slide.blocks[0].position.horizontal, "center")
  assert.equal(slide.directives.find(directive => directive.type === "art").source_range.end, 8)
  assert.deepEqual(slide.art_diagnostics || [], [])
})

test("ART-SRC-005: content after the target root list remains a separate Markdown block", () => {
  const source = "# Keep\n\nBefore\n\n:::art\n- Alpha\n- Beta\n\nAfter\n\nTail"
  const slide = buildEditorStructure(source, { mode: "presentation" }).editorMap.slides[0]

  assert.deepEqual(slide.blocks.map(block => block.markdown), [
    "# Keep",
    "Before",
    "- Alpha\n- Beta",
    "After",
    "Tail"
  ])
  assert.deepEqual(slide.blocks[2].art.source_range, { start: 16, end: 23 })
})

test("ART-EDIT-ORPHAN: Art stays unbound after a barrier and cannot jump to a later list", () => {
  const structure = buildEditorStructure(":::art\nA paragraph.\n\n- Later", { mode: "document" })
  assert.equal(structure.editorMap.slides[0].blocks.length, 2)
  assert.ok(structure.editorMap.slides[0].blocks.every(block => !block.art))
  assert.deepEqual(structure.editorMap.art_diagnostics.map(diagnostic => diagnostic.code), ["ART_NO_LIST_TARGET"])
})

test("ART-BOUNDARY-HEADING: adjacent heading ends the Art list in editor mapping and preview", () => {
  const source = ":::art\n- Alpha\n- Beta\n## After"
  const structure = buildEditorStructure(source, { mode: "document" })
  const preview = renderPreview({ kind: "document", source })
  const { document } = parseHTML(preview.html)
  const slide = structure.editorMap.slides[0]

  assert.deepEqual(slide.blocks.map(block => block.markdown), ["- Alpha\n- Beta", "## After"])
  assert.ok(slide.blocks[0].art)
  assert.equal(slide.blocks[1].art, undefined)
  assert.equal(document.querySelectorAll("[data-elef-art-root] .elef-art-list > li").length, 2)
  assert.equal(document.querySelector("h2")?.textContent, "After")
  assert.equal(document.querySelector("[data-elef-art-root]")?.closest(".document-editor-block-shell")?.nextElementSibling?.querySelector("h2")?.textContent, "After")
})

test("ART-BOUNDARY-THEMATIC: adjacent thematic break stays outside the Art list", () => {
  const source = ":::art\n- Alpha\n- Beta\n***\nAfter"
  const structure = buildEditorStructure(source, { mode: "document" })
  const preview = renderPreview({ kind: "document", source })
  const { document } = parseHTML(preview.html)
  const slide = structure.editorMap.slides[0]

  assert.deepEqual(slide.blocks.map(block => block.markdown), ["- Alpha\n- Beta", "***", "After"])
  assert.ok(slide.blocks[0].art)
  assert.equal(slide.blocks.slice(1).filter(block => block.art).length, 0)
  assert.equal(document.querySelectorAll("[data-elef-art-root] .elef-art-list > li").length, 2)
  assert.ok(document.querySelector("hr"))
  const renderedBlocks = [...document.querySelectorAll(".document-editor-block-shell")]
  assert.equal(renderedBlocks.length, 3)
  assert.equal(renderedBlocks[2].querySelector("p")?.textContent, "After")
})

test("ART-BOUNDARY-LEGACY-MARGIN: a footnote after paragraph text remains metadata", () => {
  const source = "# Review\n\nThe baseline is ready.\n:::footnote{Source: May operating review}"
  const structure = buildEditorStructure(source, { mode: "presentation" })
  const preview = renderPreview({ kind: "presentation", source })
  const { document } = parseHTML(preview.html)

  assert.equal(structure.slides[0].footnote, "Source: May operating review")
  assert.equal(document.querySelector(".slide-margin-footnote-text")?.textContent.trim(), "Source: May operating review")
})

test("ART-ARCH-MATH-BOUNDARY: multiline dollar math remains one rendered block", () => {
  const source = "# Math\n\n$$x^2\n$$"
  const structure = buildEditorStructure(source, { mode: "document" })
  const preview = renderPreview({ kind: "document", source })

  assert.deepEqual(structure.slides[0].blocks.map(block => block.markdown), ["# Math", "$$x^2\n$$"])
  assert.match(preview.html, /class="katex-display"/)
})

for (const [testId, directive] of [
  ["ART-BOUNDARY-NESTED-NOTE", ":::note"],
  ["ART-BOUNDARY-NESTED-ART", ":::art"]
]) {
  test(`${testId}: indented directive-looking list text remains in the bound list`, () => {
    const source = `:::art\n- Item one\n  ${directive}\n- Item two`
    const structure = buildEditorStructure(source, { mode: "document" })
    const preview = renderPreview({ kind: "document", source })
    const { document } = parseHTML(preview.html)
    const slide = structure.editorMap.slides[0]
    const root = document.querySelector("[data-elef-art-root]")

    assert.equal(slide.blocks.length, 1)
    assert.equal(slide.blocks[0].markdown, `- Item one\n  ${directive}\n- Item two`)
    assert.ok(slide.blocks[0].art)
    assert.deepEqual(slide.directives.map(item => item.type), ["art"])
    assert.deepEqual(slide.art_diagnostics || [], [])
    assert.equal(root?.querySelectorAll(":scope > .elef-art-list > li").length, 2)
    assert.match(root?.querySelector(":scope > .elef-art-list > li")?.textContent || "", new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.match(root?.textContent || "", /Item two/)
  })
}

test("ART-BOUNDARY-NESTED-MARGIN: indented margin directives remain in the bound Art list", () => {
  const source = ":::art\n- Item one\n  :::section{Nested}\n- Item two"
  const structure = buildEditorStructure(source, { mode: "presentation" })
  const preview = renderPreview({ source, kind: "presentation" })
  const { document } = parseHTML(preview.html)
  const slide = structure.editorMap.slides[0]
  const root = document.querySelector("[data-elef-art-root]")

  assert.equal(slide.blocks.length, 1)
  assert.ok(slide.blocks[0].art)
  assert.equal(structure.slides[0].section, null)
  assert.equal(root?.querySelectorAll(":scope > .elef-art-list > li").length, 2)
  assert.match(root?.querySelector(":scope > .elef-art-list > li")?.textContent || "", /:::section\{Nested\}/)
  assert.equal(document.querySelector(".slide-margin-section")?.textContent, "")
})

test("ART-ARCH-RESOLUTION-ONCE: margin directive barriers resolve identically for editor and renderer", () => {
  const source = ":::art\n:::section{Intro}\n- A"
  const structure = buildEditorStructure(source, { mode: "presentation" })
  const preview = renderPreview({ source, kind: "presentation" })
  const { document } = parseHTML(preview.html)
  const slide = structure.editorMap.slides[0]

  assert.equal(slide.blocks.length, 1)
  assert.equal(slide.blocks[0].art, undefined)
  assert.deepEqual(slide.art_diagnostics.map(diagnostic => diagnostic.code), ["ART_NO_LIST_TARGET"])
  assert.equal(document.querySelectorAll("[data-elef-art-root]").length, 0)
  assert.deepEqual(preview.editor_map.art_diagnostics.map(diagnostic => diagnostic.code), ["ART_NO_LIST_TARGET"])
  assert.equal(document.querySelector("li")?.textContent, "A")
})

test("Art source mapping stays responsive across thousands of Markdown blocks and targets", () => {
  const parts = []
  for (let index = 0; index < 6000; index += 1) {
    parts.push(`Paragraph ${index}.`)
    if (index % 6 === 0) parts.push(`:::art\n- Item ${index}`)
  }
  const source = parts.join("\n\n")
  const startedAt = performance.now()
  const structure = buildEditorStructure(source, { mode: "document" })
  const elapsed = performance.now() - startedAt
  const blocks = structure.editorMap.slides[0].blocks

  assert.equal(blocks.length, 7000)
  assert.equal(blocks.filter(block => block.art).length, 1000)
  assert.ok(elapsed < 1500, `mapping 6000 paragraphs and 1000 Art lists took ${Math.round(elapsed)}ms`)
})

test("ART-SRC-INVALID-PARITY: invalid Art is consumed with only its stable Art diagnostic", () => {
  const source = ":::art{flow}\n- A"
  const structure = buildEditorStructure(source, { mode: "document" })
  const preview = renderPreview({ kind: "document", source })
  const { document } = parseHTML(preview.html)

  assert.equal(structure.editorMap.slides[0].directives[0].type, "art_invalid")
  assert.deepEqual(structure.editorMap.art_diagnostics.map(diagnostic => diagnostic.code), ["ART_INVALID_SYNTAX"])
  assert.ok(structure.warnings.some(warning => warning.includes("syntax is invalid")))
  assert.ok(structure.warnings.every(warning => !warning.includes("Unknown or malformed presentation directive")))
  assert.doesNotMatch(document.body.textContent, /:::art\{flow\}/)
  assert.equal(document.querySelectorAll("[data-elef-art-root]").length, 0)
})
