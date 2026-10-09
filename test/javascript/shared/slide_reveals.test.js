import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildEditorStructure } from "../../../app/javascript/lib/document_map.js"
import { renderPreview } from "../../../app/javascript/lib/renderer.js"
import { installSanitizedPreview } from "../../../app/javascript/lib/preview_sanitizer.js"
import { parseHTML } from "linkedom"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const fixtures = JSON.parse(await readFile(path.join(root, "test/fixtures/slide-reveals/parity-cases.json"), "utf8"))

function sourceFor(fixture) {
  return fixture.long_label_digits
    ? fixture.source.replaceAll("@LONG_LABEL@", "9".repeat(fixture.long_label_digits))
    : fixture.source
}

function canonicalBlocks(slide) {
  return slide.blocks.map(block => ({
    markdown: block.markdown,
    reveal_event: block.reveal_event ?? null,
    position: block.position ? [block.position.horizontal, block.position.vertical] : null
  }))
}

for (const fixture of fixtures) {
  test(`shared reveal contract: ${fixture.name}`, () => {
    const source = sourceFor(fixture)
    const structure = buildEditorStructure(source, { sourceName: "Reveal fixture", mode: fixture.mode })

    assert.deepEqual(structure.slides.map(canonicalBlocks), fixture.expected_slide_blocks)
    assert.deepEqual(structure.slides.map(slide => slide.reveal_event_count ?? 0), fixture.event_counts)
    assert.deepEqual(structure.warnings, fixture.warnings)

    for (const [slideIndex, slide] of structure.editorMap.slides.entries()) {
      const mappedSource = source.slice(slide.source_range.start, slide.source_range.end)
      assert.equal(mappedSource, source.slice(slide.range.start, slide.range.end))
      assert.equal(slide.blocks.length, fixture.expected_slide_blocks[slideIndex].length)
      for (const [blockIndex, block] of slide.blocks.entries()) {
        assert.equal(source.slice(block.content_range.start, block.content_range.end), block.markdown)
        assert.equal(block.reveal_event ?? null, fixture.expected_slide_blocks[slideIndex][blockIndex].reveal_event)
      }
      for (const directive of slide.directives) {
        assert.equal(source.slice(directive.source_range.start, directive.source_range.end).trim(), directive.text)
      }
    }
  })
}

test("presentation HTML annotates stepped titles, blocks, media, and invalid editability projections", () => {
  const source = [
    ":::step",
    "# Stepped title",
    "",
    "## First column",
    ":::step{01}",
    "First detail",
    "",
    "## Second column",
    ":::step{1}",
    "[Uneditable nested link](https://example.test/a(b))",
    "",
    ":::step{2}",
    "![Clip](https://example.test/clip.png)"
  ].join("\n")
  const rendered = renderPreview({ source, allowRemoteMedia: true })
  const { document } = parseHTML(`<html><body><div id="preview">${rendered.html}</div></body></html>`)
  const title = document.querySelector(".slide-title.slide-block")
  const blocks = [...document.querySelectorAll(".slide-block[data-elef-reveal-event]")]
  const media = blocks.find(block => block.querySelector("img"))

  assert.equal(title.getAttribute("data-elef-reveal-event"), "0")
  assert.equal(blocks.filter(block => block.getAttribute("data-elef-reveal-event") === "1").length, 2)
  assert.ok(blocks.some(block => block.getAttribute("data-elef-reveal-event") === "2"))
  assert.ok(media)
  assert.equal(document.querySelector(".slide").getAttribute("data-elef-reveal-event-count"), "3")
  assert.doesNotMatch(rendered.html, /:::step/)
  assert.ok(rendered.html.includes('data-elef-reveal-event="1"'))
  const invalidBlock = rendered.editor_map.slides[0].blocks.find(block => block.markdown.includes("nested link"))
  const invalidRegion = rendered.editor_map.editable_regions.find(region => region.id === invalidBlock.editable_region_id)
  assert.equal(invalidRegion.editable, false)
  assert.equal(blocks.find(block => block.textContent.includes("nested link")).getAttribute("data-elef-reveal-event"), "1")
})

test("reveal ordinals survive the sanitized preview install", () => {
  const source = "# Title\n\n:::step{7}\nA reveal"
  const html = renderPreview({ source }).html
  const { document } = parseHTML("<html><body><div id='preview'></div></body></html>")
  const preview = document.querySelector("#preview")
  installSanitizedPreview(preview, html)

  assert.equal(preview.querySelector(".slide").getAttribute("data-elef-reveal-event-count"), "1")
  assert.equal(preview.querySelector(".slide-block[data-elef-reveal-event]").getAttribute("data-elef-reveal-event"), "0")
})

test("presentation HTML keeps SmartArt inside its stepped content wrapper after sanitization", () => {
  const source = "# Art\n\n:::step\n:::art\n- Research\n  - Read\n- Design"
  const html = renderPreview({ source }).html
  const { document } = parseHTML("<html><body><div id='preview'></div></body></html>")
  const preview = document.querySelector("#preview")
  installSanitizedPreview(preview, html)
  const block = preview.querySelector('.slide-block[data-elef-reveal-event="0"]')

  assert.ok(block)
  assert.ok(block.querySelector(".elef-art"))
  assert.ok(block.querySelector(".elef-art-list"))
  assert.doesNotMatch(preview.innerHTML, /:::step/)
})

test("document rendering keeps step directives out of reveal visibility", () => {
  const preview = renderPreview({ source: "# Notes\n\n:::step{1}\n- item", kind: "document" })
  assert.doesNotMatch(preview.html, /data-elef-reveal-event/)
  assert.deepEqual(preview.warnings, ["Unknown or malformed presentation directive was removed."])
})
