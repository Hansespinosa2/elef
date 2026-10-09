import test from "node:test"
import assert from "node:assert/strict"
import { renderMarkdownBlock as renderBlockCore, renderPreviewCore } from "@elef/renderer"
import { editorChrome } from "../../app/javascript/lib/preview_chrome.js"

// Composed output: bare projection + editor chrome, exactly as the shipped
// bundle serves it. Chrome assertions live here (not in the package) because
// packages/renderer must stay chrome-free.
const renderPreview = input => renderPreviewCore(input, { chrome: editorChrome })
const renderMarkdownBlock = (source, options) => renderBlockCore(source, { ...options, chrome: editorChrome })

test("composed presentation preview carries theme, slide frames and block hooks", () => {
  const source = "---\ntheme: dark\n---\n# One\n\nText 😀\n\n```md\n---\n```\n---\n# Two"
  const preview = renderPreview({ source, title: "Deck" })

  assert.match(preview.html, /slides-theme-dark/)
  assert.equal((preview.html.match(/class="slide slide-body"/g) || []).length, 2)
  assert.match(preview.html, /data-editor-block-id="slide-1-block-1"/)
})

test("composed presentation preview carries block controls", () => {
  const preview = renderPreview({ source: "# Roadmap\n\nFirst column.", title: "Plan" })

  assert.match(preview.html, /data-presentation-editor-action="add-block-after"/)
})

test("composed document preview joins blocks inside editor shells", () => {
  const html = renderPreview({
    kind: "document",
    source: "# Notes\n\nFirst, don't change this punctuation.\n\nSecond block.\n"
  }).html

  assert.doesNotMatch(html, /<\/div>,<div class="document-editor-block-shell">/)
  assert.match(html, /<div class="document-editor-block-shell">/)
})

test("composed projection carries style roots and region hooks", () => {
  const preview = renderPreview({
    source: "# Notes\n\nBody",
    kind: "document",
    title: "Notes",
    style: { theme: "dark", typography: "technical" }
  })

  assert.match(preview.html, /document-theme-dark document-typography-technical/)
  assert.match(preview.html, /data-editor-region-id=/)
})

test("composed presentation projection exposes Stimulus canvas targets to host controllers", () => {
  const preview = renderPreview({ source: "# One\\n\\nBody", kind: "presentation" })

  assert.match(preview.html, /data-presentation-editor-target="canvas"/)
  assert.match(preview.html, /data-presentation-canvas-target="canvas"/)
})

test("composed wiki math keeps edit-roundtrip source attributes", () => {
  const preview = renderPreview({
    kind: "document",
    deckId: "source",
    source: "# Source\n\n[[Target|open target]] and $x^2$.",
    documentNodes: [{ id: "target-id", title: "Target" }]
  })

  assert.match(preview.html, /data-editor-math-source="x\^2"/)
})

test("composed projections preserve safe relative image paths and editable captions", () => {
  for (const kind of ["document", "presentation"]) {
    const preview = renderPreview({
      source: "![Diagram](/diagram.svg)",
      kind,
      title: "Diagram",
      deckId: "deck-id",
      allowRemoteMedia: true
    })

    assert.match(preview.html, /<img[^>]+src="\/diagram\.svg"[^>]+data-editor-image-source="true" contenteditable="false">/)
    assert.match(preview.html, /<figcaption class="editor-media-caption"[^>]*>Diagram<\/figcaption>/)
  }
})

test("composed Markdown blocks keep KaTeX edit-roundtrip attributes", () => {
  const html = renderMarkdownBlock("Inline \\(\\bar{x}\\), display \\[x^2\\], and https://example.com")
  assert.match(html, /data-editor-math-open="\\\("/)
  assert.match(html, /data-editor-math-close="\\\]"/)
  assert.match(html, /href="https:\/\/example\.com"/)
})

test("composed empty display math retains its exact inner source whitespace for visual editing", () => {
  for (const [opening, closing] of [["$$", "$$"], ["\\[", "\\]"]]) {
    const html = renderMarkdownBlock(`# Untitled document\n\n${opening}\n\n${closing}`)
    assert.ok(html.includes('data-editor-math-source="\n\n"'))
    assert.ok(html.includes(`data-editor-math-open="${opening}"`))
    assert.ok(html.includes(`data-editor-math-close="${closing}"`))
    assert.ok(!html.includes(`data-editor-math-source="${opening}`))
  }
})
