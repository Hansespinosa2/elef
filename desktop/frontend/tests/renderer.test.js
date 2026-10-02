import test from "node:test"
import assert from "node:assert/strict"
import { collectMediaReferences, renderMarkdownBlock, renderPreview } from "../src/renderer.js"
import { buildEditorMap } from "../src/document-map.js"

test("presentation preview builds editable source ranges and ignores slide delimiters in code fences", () => {
  const source = "---\ntheme: dark\n---\n# One\n\nText 😀\n\n```md\n---\n```\n---\n# Two"
  const preview = renderPreview({ source, title: "Deck" })

  assert.equal(preview.editor_map.slides.length, 2)
  assert.equal(preview.editor_map.front_matter.body_start, source.indexOf("# One"))
  assert.equal(preview.editor_map.source_length, source.length)
  assert.match(preview.html, /slides-theme-dark/)
  assert.equal((preview.html.match(/class="slide slide-body"/g) || []).length, 2)
  assert.match(preview.html, /data-editor-block-id="slide-1-block-1"/)
  assert.match(preview.html, /<code[^>]*>---/)
  assert.equal(preview.editor_map.slides[1].blocks[0].markdown, "# Two")
})

test("desktop presentation structure comes from the same source map exported to Rails", () => {
  const source = [
    "---",
    "theme: dark",
    "show-in-margin:",
    "  section: true",
    "---",
    ":::section{Planning}",
    "# Roadmap 😀",
    "",
    "## First",
    "",
    "First column.",
    "",
    "## Second",
    "",
    "Second column.",
    "---",
    "# Code sample",
    "",
    "```md",
    "---",
    "```"
  ].join("\n")
  const preview = renderPreview({ source, title: "Quarterly plan" })

  assert.deepEqual(preview.editor_map, buildEditorMap(source, {
    sourceName: "Quarterly plan",
    mode: "presentation"
  }))
  assert.equal(preview.editor_map.source_length, source.length)
  assert.equal(preview.editor_map.slides[0].layout, "two-column")
  assert.equal(preview.editor_map.slides[0].directives[0].type, "section")
  assert.equal(preview.editor_map.slides[1].blocks.length, 2)
  assert.match(preview.html, /class="slide slide-two-column"/)
  assert.match(preview.html, /class="slide-regions"/)
  assert.match(preview.html, /data-presentation-editor-action="add-block-after"/)
  assert.match(preview.html, /class="slide-margin-section"/)
})

test("document preview renders basic Markdown with safe content-addressed local assets", () => {
  const digest = "a".repeat(64)
  const preview = renderPreview({
    kind: "document",
    deckId: "document-1",
    source: "# Notes\n\n![Diagram](elef-asset:" + digest + " \"fit:cover\")\n\n![Remote](https://example.com/diagram.png)\n\n<script>alert(1)</script>",
    mediaBaseUrl: "elefasset://localhost/document-1"
  })

  assert.match(preview.html, /<h1>Notes<\/h1>/)
  assert.match(preview.html, new RegExp(`src="elefasset://localhost/document-1/${digest}"`))
  assert.doesNotMatch(preview.html, /example\.com/)
  assert.doesNotMatch(preview.html, /<script>/)
  assert.match(preview.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test("wiki links resolve through local document IDs and math stays inert", () => {
  const preview = renderPreview({
    kind: "document",
    deckId: "source",
    source: "# Source\n\n[[Target|open target]] and $x^2$.",
    documentNodes: [{ id: "target-id", title: "Target" }]
  })

  assert.match(preview.html, /href="#deck\/target-id"/)
  assert.match(preview.html, />open target<\/a>/)
  assert.match(preview.html, /data-editor-math-source="x\^2"/)
  assert.doesNotMatch(preview.html, /javascript:/i)
})

test("preview rejects non-text and oversized source with typed errors", () => {
  assert.throws(() => renderPreview({ source: 42 }), { code: "invalid_input", retryable: false })
  assert.throws(() => renderPreview({ source: "x".repeat(50 * 1024 * 1024 + 1) }), { code: "too_large", retryable: false })
})

test("shared Markdown block renderer keeps media resolution explicit and supports web media", () => {
  const source = "![Photo](images/diagram.png) ![Clip](elef-asset:clip) ![Remote](https://example.com/a.png)"
  const references = collectMediaReferences(source)
  assert.deepEqual(references, ["images/diagram.png", "elef-asset:clip", "https://example.com/a.png"])

  const local = renderMarkdownBlock(source, {
    mediaBaseUrl: "elefasset://localhost/deck-id",
    mediaMap: { "elef-asset:clip": { src: "/media/clip.mp4", contentType: "video/mp4" } }
  })
  assert.match(local, /elefasset:\/\/localhost\/deck-id\/path\/images\/diagram\.png/)
  assert.match(local, /<video[^>]+src="\/media\/clip\.mp4"[^>]+controls playsinline/)
  assert.doesNotMatch(local, /example\.com/)

  const web = renderMarkdownBlock(source, { allowRemoteMedia: true })
  assert.match(web, /src="images\/diagram\.png"/)
  assert.match(web, /src="https:\/\/example\.com\/a\.png"/)
})

test("shared Markdown block renderer supports both KaTeX delimiter families and autolinks", () => {
  const html = renderMarkdownBlock("Inline \\(\\bar{x}\\), display \\[x^2\\], and https://example.com")
  assert.match(html, /data-editor-math-open="\\\("/)
  assert.match(html, /data-editor-math-close="\\\]"/)
  assert.match(html, /href="https:\/\/example\.com"/)
})

test("empty display math retains its exact inner source whitespace for visual editing", () => {
  for (const [opening, closing] of [["$$", "$$"], ["\\[", "\\]"]]) {
    const html = renderMarkdownBlock(`# Untitled document\n\n${opening}\n\n${closing}`)
    assert.ok(html.includes('data-editor-math-source="\n\n"'))
    assert.ok(html.includes(`data-editor-math-open="${opening}"`))
    assert.ok(html.includes(`data-editor-math-close="${closing}"`))
    assert.ok(!html.includes(`data-editor-math-source="${opening}`))
  }
})
