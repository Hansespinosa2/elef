import test from "node:test"
import assert from "node:assert/strict"
import { collectMediaReferences, renderMarkdownBlock, renderPreview } from "../../app/javascript/lib/renderer.js"
import { buildEditorMap, buildEditorStructure } from "../../app/javascript/lib/document_map.js"

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

test("position directive binds to exactly the single next block and bare ::: does not extend scope", () => {
  const source = "# Slide\n\n:::align{center}\n\nFirst\n\nSecond\n\n:::\n\nOutside"
  const map = buildEditorMap(source, { mode: "presentation" })
  const blocks = map.slides[0].blocks

  assert.equal(blocks.length, 4)
  assert.equal(blocks[0].markdown, "# Slide")
  assert.equal(blocks[0].position, null)
  assert.equal(blocks[1].markdown, "First")
  assert.deepEqual(blocks[1].position, { horizontal: "center", vertical: "top", vertical_explicit: false })
  assert.equal(blocks[2].markdown, "Second")
  assert.equal(blocks[2].position, null)
  assert.equal(blocks[3].markdown, "Outside")
  assert.equal(blocks[3].position, null)
  assert.equal(blocks[1].position_directive_id, map.slides[0].directives[0].id)
  assert.equal(blocks[2].position_directive_id, null)

  const structure = buildEditorStructure(source, { mode: "presentation" })
  assert.ok(structure.warnings.includes("Unknown or malformed presentation directive was removed."))
})

test("bare ::: alone is typed as unknown directive and warns without affecting positioning", () => {
  const source = "# Slide\n\n:::\n\nFirst"
  const structure = buildEditorStructure(source, { mode: "presentation" })
  const map = structure.editorMap

  assert.equal(map.slides[0].directives[0].type, "unknown")
  assert.equal(map.slides[0].blocks[1].position, null)
  assert.deepEqual(structure.warnings, ["Unknown or malformed presentation directive was removed."])
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

test("document preview joins blocks without inserting punctuation between them", () => {
  const html = renderPreview({
    kind: "document",
    source: "# Notes\n\nFirst, don't change this punctuation.\n\nSecond block.\n"
  }).html

  assert.doesNotMatch(html, /<\/div>,<div class="document-editor-block-shell">/)
  assert.match(html, /<p>First, don't change this punctuation\.<\/p>/)
  assert.match(html, /<p>Second block\.<\/p>/)
})

test("full editor projection accepts platform document links, settings, and assets", () => {
  const preview = renderPreview({
    source: "# Notes\n\n[[Target alias|Open target]] and [[document:target-key]] and [[Missing|Missing target]]\n\n![diagram](elef-asset:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)",
    kind: "document",
    title: "Notes",
    documentNodes: [{ id: "target-id", title: "Target", documentKey: "target-key", aliases: ["Target alias"], href: "/documents/target-id" }],
    mediaMap: { "elef-asset:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { src: "/media/asset.png", contentType: "image/png" } },
    style: { theme: "dark", typography: "technical" }
  })

  assert.equal(preview.editor_map.mode, "document")
  assert.deepEqual(preview.warnings, [])
  assert.match(preview.html, /document-theme-dark document-typography-technical/)
  assert.match(preview.html, /href="\/documents\/target-id"/)
  assert.match(preview.html, /data-document-link-title="Target"/)
  assert.match(preview.html, />Open target<\/a>/)
  assert.match(preview.html, />Target<\/a>/)
  assert.match(preview.html, /class="document-link unresolved" aria-label="Unresolved document link">\[\[Missing target\]\]<\/span>/)
  assert.match(preview.html, /src="\/media\/asset\.png"/)
  assert.match(preview.html, /data-editor-region-id=/)
})

test("renderer links resolve portable document keys and aliases from Markdown", () => {
  const preview = renderPreview({
    kind: "document",
    source: "# Source\n\n[[document:portable-key|by key]] [[Earlier title|by alias]]",
    documentNodes: [{
      id: "manifest-id",
      title: "Current title",
      source: `---\nelef_document_key: "portable-key"\nelef_aliases: ["Earlier title"]\n---\n# Current title`
    }]
  })

  assert.equal((preview.html.match(/href="#deck\/manifest-id"/g) || []).length, 2)
  assert.match(preview.html, />by key<\/a>/)
  assert.match(preview.html, />by alias<\/a>/)
})

test("presentation editor projection exposes Stimulus canvas targets to host controllers", () => {
  const preview = renderPreview({ source: "# One\\n\\nBody", kind: "presentation" })

  assert.match(preview.html, /data-presentation-editor-target="canvas"/)
  assert.match(preview.html, /data-presentation-canvas-target="canvas"/)
})

test("Art derives Peers or Sequence from the native root list and preserves nested list semantics", () => {
  const peers = renderPreview({
    kind: "document",
    source: ":::art\n- Research\n  1. Interview users\n  2. Review competitors\n     - Enterprise\n     - Consumer\n- Design\n  - Prototype\n  - Validate"
  })
  const sequence = renderPreview({
    kind: "document",
    source: ":::art\n3. Alpha\n4. Beta\n   - detail"
  })

  assert.match(peers.html, /<section class="elef-art"[^>]*data-art-mode="peers"[^>]*data-art-density="rich"/)
  assert.match(peers.html, /<ul class="elef-art-list" role="list">/)
  assert.match(peers.html, /<ol>\s*<li>Interview users<\/li>/)
  assert.match(peers.html, /<li>Review competitors\s*<ul>\s*<li>Enterprise<\/li>\s*<li>Consumer<\/li>/)
  assert.match(peers.html, /<ul>\s*<li>Prototype<\/li>/)
  assert.match(sequence.html, /<section class="elef-art"[^>]*data-art-mode="sequence"[^>]*data-art-density="rich"/)
  assert.match(sequence.html, /<ol class="elef-art-list" start="3">/)
  assert.doesNotMatch(sequence.html, /<ol class="elef-art-list"[^>]*role=/)
  assert.match(sequence.html, /data-art-layout="sequence-vertical" data-art-settled="true"/)
  assert.doesNotMatch(peers.html, /:::art/)
})

test("ART-SEM-006: an empty root Art item remains an empty compact native list item", () => {
  const preview = renderPreview({ kind: "document", source: ":::art\n-\n- Filled" })

  assert.match(preview.html, /data-art-mode="peers" data-art-density="compact"/)
  assert.match(preview.html, /<ul class="elef-art-list" role="list">/)
  assert.equal((preview.html.match(/<li>/g) || []).length, 2)
  assert.match(preview.html, /<li><\/li>/)
  assert.match(preview.html, /<li>Filled<\/li>/)
})

test("FIX-09: document ranking keeps native ordered semantics and vertical Sequence layout", () => {
  const source = ":::art\n1. Reliability\n2. Simplicity\n3. Performance\n4. Portability\n5. Transparency\n6. Extensibility"
  const preview = renderPreview({ kind: "document", source })

  assert.match(preview.html, /data-art-mode="sequence" data-art-density="compact"/)
  assert.match(preview.html, /<ol class="elef-art-list">/)
  assert.match(preview.html, /data-art-layout="sequence-vertical" data-art-settled="true"/)
  assert.equal((preview.html.match(/<li>/g) || []).length, 6)
})

test("ART-FIX-10: inline image content selects whole-list fallback and remains rendered", () => {
  const preview = renderPreview({
    kind: "document",
    source: ":::art\n- Research\n  - Review evidence\n- Prototype\n  ![mockup](images/mockup.png)",
    mediaMap: { "images/mockup.png": { src: "/media/mockup.png", contentType: "image/png" } }
  })

  assert.match(preview.html, /data-art-status="fallback-unsupported" data-art-layout="plain-list"/)
  assert.match(preview.html, /data-art-diagnostic="ART_UNSUPPORTED_CONTENT"/)
  assert.match(preview.html, /<ul class="elef-art-list" role="list">/)
  assert.equal((preview.html.match(/<li>/g) || []).length, 3)
  assert.match(preview.html, /src="\/media\/mockup\.png" alt="mockup"/)
  assert.match(preview.html, /Prototype/)
  assert.deepEqual(preview.editor_map.art_diagnostics.map(diagnostic => diagnostic.code), ["ART_UNSUPPORTED_CONTENT"])
})

test("ART-TEST-005: identical parsed Art and render inputs produce identical previews", () => {
  const options = {
    source: ":::art\n1. Discover\n2. Design\n3. Build\n4. Launch",
    style: { theme: "dark", typography: "technical" }
  }
  const first = renderPreview(options)
  const second = renderPreview(options)
  assert.equal(second.html, first.html)
  assert.deepEqual(second.warnings, first.warnings)
  assert.deepEqual(second.editor_map, first.editor_map)
  assert.deepEqual(second.style, first.style)
})

test("ART-DIAG-002: malformed directive payloads never enter diagnostic attributes or executable markup", () => {
  const payload = ':::art{flow" data-probe="owned onload="alert(1)"}'
  const preview = renderPreview({ kind: "document", source: `${payload}\n- Safe text` })

  assert.deepEqual(preview.editor_map.art_diagnostics.map(diagnostic => diagnostic.code), ["ART_INVALID_SYNTAX"])
  assert.doesNotMatch(preview.html, /data-probe|onload=|<script\b/)
  assert.doesNotMatch(preview.html, /:::art\{flow/)
  for (const [, value] of preview.html.matchAll(/\bdata-[\w-]+="([^"]*)"/g)) {
    assert.doesNotMatch(value, /ART_INVALID_SYNTAX|flow|data-probe|alert/)
  }
})

test("Art has a complete server-rendered fixed-host default and unsupported content falls back as a whole list", () => {
  const pending = renderPreview({ source: ":::art\n1. Discover\n2. Design\n3. Build\n4. Launch" })
  const unsupported = renderPreview({
    kind: "document",
    source: ":::art\n- Research\n  - Review evidence\n\n  ~~~js\n  const answer = 42\n  ~~~"
  })

  assert.match(pending.html, /data-art-host="fixed" data-art-overfull="false"/)
  assert.match(pending.html, /data-art-status="pending" data-art-layout="sequence-vertical" data-art-settled="false" data-art-mode="sequence" data-art-density="compact"/)
  assert.match(unsupported.html, /data-art-status="fallback-unsupported" data-art-layout="plain-list"/)
  assert.match(unsupported.html, /data-art-diagnostic="ART_UNSUPPORTED_CONTENT"/)
  assert.match(unsupported.html, /answer =/)
  assert.deepEqual(unsupported.editor_map.art_diagnostics.map(diagnostic => diagnostic.code), ["ART_UNSUPPORTED_CONTENT"])
})

test("Art CRLF source remains editable and uses the original Art directive range", () => {
  const source = ":::art\r\n0. Zero\r\n1. One"
  const preview = renderPreview({ kind: "document", source })
  const block = preview.editor_map.slides[0].blocks.find(candidate => candidate.art)

  assert.equal(block.markdown, "0. Zero\r\n1. One")
  assert.deepEqual(block.art.source_range, { start: 0, end: 8 })
  assert.match(preview.html, /contenteditable="true"/)
  assert.match(preview.html, /<ol class="elef-art-list" start="0">/)
})

test("document projection keeps trailing list and quote lines editable", () => {
  const list = renderPreview({ kind: "document", source: "# Notes\n\n- First item\n- " }).html
  const quote = renderPreview({ kind: "document", source: "# Notes\n\n> First line\n> " }).html

  assert.match(list, /<li>First item<\/li>\s*<li><br><\/li>/)
  assert.match(quote, /<blockquote>\s*<p>First line<\/p>\s*<p><br><\/p>/)
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

test("editable web projections preserve safe relative image paths and editable captions", () => {
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

  const desktop = renderPreview({
    source: "![Remote diagram](/diagram.svg)",
    kind: "document",
    title: "Diagram",
    deckId: "deck-id"
  })
  assert.doesNotMatch(desktop.html, /src="\/diagram\.svg"/)
})

test("the shared renderer does not invent a desktop asset protocol when no media base is supplied", () => {
  const digest = "a".repeat(64)
  const preview = renderPreview({
    source: `![Missing](elef-asset:${digest})`,
    deckId: "deck-id"
  })

  assert.doesNotMatch(preview.html, /elefasset:\/\//)
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
