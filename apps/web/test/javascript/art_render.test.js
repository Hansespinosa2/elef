import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { renderPreviewCore } from "@elef/renderer"
import { editorChrome } from "@elef/editor-runtime/editor-chrome"
import { buildEditorStructure, resolveArtBindings } from "@elef/work-model"

const renderPreview = input => renderPreviewCore(input, { chrome: editorChrome })

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
