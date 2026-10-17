import test from "node:test"
import assert from "node:assert/strict"
import { collectMediaReferences, renderMarkdownBlock, renderPreviewCore } from "../src/index.js"
import type { RendererChrome } from "../src/index.js"
import { renderMarkdownBlock as renderProjectionBlock } from "../src/projection.js"
import { buildEditorMap, buildEditorStructure } from "@elef/work-model"

test("presentation preview builds editable source ranges and ignores slide delimiters in code fences", () => {
  const source = "---\ntheme: dark\n---\n# One\n\nText 😀\n\n```md\n---\n```\n---\n# Two"
  const preview = renderPreviewCore({ source, title: "Work" })

  assert.equal(preview.editor_map.slides.length, 2)
  assert.equal(preview.editor_map.front_matter?.body_start, source.indexOf("# One"))
  assert.equal(preview.editor_map.source_length, source.length)
  assert.match(preview.html, /<div class="presentation">/)
  assert.equal((preview.html.match(/<section class="slide slide-body">/g) || []).length, 2)
  assert.match(preview.html, /<code[^>]*>---/)
  const secondSlide = preview.editor_map.slides[1]
  assert.ok(secondSlide)
  assert.equal(secondSlide.blocks[0]?.markdown, "# Two")
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
  const preview = renderPreviewCore({ source, title: "Quarterly plan" })

  assert.deepEqual(preview.editor_map, buildEditorMap(source, {
    sourceName: "Quarterly plan",
    mode: "presentation"
  }))
  assert.equal(preview.editor_map.source_length, source.length)
  const firstSlide = preview.editor_map.slides[0]
  const secondSlide = preview.editor_map.slides[1]
  assert.ok(firstSlide)
  assert.ok(secondSlide)
  assert.equal(firstSlide.layout, "two-column")
  assert.equal(firstSlide.directives[0]?.type, "section")
  assert.equal(secondSlide.blocks.length, 2)
  assert.match(preview.html, /<section class="slide slide-two-column">/)
  assert.match(preview.html, /class="slide-regions"/)
  assert.match(preview.html, /class="slide-margin-section"/)
})

test("document preview renders basic Markdown with safe content-addressed local assets", () => {
  const digest = "a".repeat(64)
  const preview = renderPreviewCore({
    kind: "document",
    workId: "document-1",
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
  const html = renderPreviewCore({
    kind: "document",
    source: "# Notes\n\nFirst, don't change this punctuation.\n\nSecond block.\n"
  }).html

  assert.doesNotMatch(html, /<\/div>,<div/)
  assert.match(html, /<p>First, don't change this punctuation\.<\/p>/)
  assert.match(html, /<p>Second block\.<\/p>/)
})

test("full projection accepts platform document links, settings, and assets", () => {
  const preview = renderPreviewCore({
    source: "# Notes\n\n[[Target alias|Open target]] and [[document:target-key]] and [[Missing|Missing target]]\n\n![diagram](elef-asset:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)",
    kind: "document",
    title: "Notes",
    documentNodes: [{ id: "target-id", title: "Target", documentKey: "target-key", aliases: ["Target alias"], href: "/documents/target-id" }],
    mediaMap: { "elef-asset:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { src: "/media/asset.png", contentType: "image/png" } },
    style: { theme: "dark", typography: "technical" }
  })

  assert.equal(preview.editor_map.mode, "document")
  assert.deepEqual(preview.warnings, [])
  assert.match(preview.html, /href="\/documents\/target-id"/)
  assert.match(preview.html, /data-document-link-title="Target"/)
  assert.match(preview.html, />Open target<\/a>/)
  assert.match(preview.html, />Target<\/a>/)
  assert.match(preview.html, /class="document-link unresolved" aria-label="Unresolved document link">\[\[Missing target\]\]<\/span>/)
  assert.match(preview.html, /src="\/media\/asset\.png"/)
})

test("renderer links resolve portable document keys and aliases from Markdown", () => {
  const preview = renderPreviewCore({
    kind: "document",
    source: "# Source\n\n[[document:portable-key|by key]] [[Earlier title|by alias]]",
    documentNodes: [{
      id: "manifest-id",
      title: "Current title",
      source: `---\nelef_document_key: "portable-key"\nelef_aliases: ["Earlier title"]\n---\n# Current title`
    }]
  })

  assert.equal((preview.html.match(/href="#work\/manifest-id"/g) || []).length, 2)
  assert.match(preview.html, />by key<\/a>/)
  assert.match(preview.html, />by alias<\/a>/)
})

test("document projection keeps trailing list and quote lines editable", () => {
  const list = renderPreviewCore({ kind: "document", source: "# Notes\n\n- First item\n- " }).html
  const quote = renderPreviewCore({ kind: "document", source: "# Notes\n\n> First line\n> " }).html

  assert.match(list, /<li>First item<\/li>\s*<li><br><\/li>/)
  assert.match(quote, /<blockquote>\s*<p>First line<\/p>\s*<p><br><\/p>/)
})

test("wiki links resolve through local document IDs and math stays inert", () => {
  const preview = renderPreviewCore({
    kind: "document",
    workId: "source",
    source: "# Source\n\n[[Target|open target]] and $x^2$.",
    documentNodes: [{ id: "target-id", title: "Target" }]
  })

  assert.match(preview.html, /href="#work\/target-id"/)
  assert.match(preview.html, />open target<\/a>/)
  assert.match(preview.html, /<span class="katex"/)
  assert.doesNotMatch(preview.html, /javascript:/i)
})

test("preview rejects non-text and oversized source with typed errors", () => {
  assert.throws(() => renderPreviewCore({ source: 42 as unknown as string }), { code: "invalid_input", retryable: false })
  assert.throws(() => renderPreviewCore({ source: "x".repeat(50 * 1024 * 1024 + 1) }), { code: "too_large", retryable: false })
})

test("shared Markdown block renderer keeps media resolution explicit and supports web media", () => {
  const source = "![Photo](images/diagram.png) ![Clip](elef-asset:clip) ![Remote](https://example.com/a.png)"
  const references = collectMediaReferences(source)
  assert.deepEqual(references, ["images/diagram.png", "elef-asset:clip", "https://example.com/a.png"])
  // Wiki links parse without a resolver and contribute no references.
  assert.deepEqual(collectMediaReferences("See [[Target|Display]] and [[Other]] for context."), [])

  const local = renderMarkdownBlock(source, {
    mediaBaseUrl: "elefasset://localhost/work-id",
    mediaMap: { "elef-asset:clip": { src: "/media/clip.mp4", contentType: "video/mp4" } }
  })
  assert.match(local, /elefasset:\/\/localhost\/work-id\/path\/images\/diagram\.png/)
  assert.match(local, /<video[^>]+src="\/media\/clip\.mp4"[^>]+controls playsinline/)
  assert.doesNotMatch(local, /example\.com/)

  const web = renderMarkdownBlock(source, { allowRemoteMedia: true })
  assert.match(web, /src="images\/diagram\.png"/)
  assert.match(web, /src="https:\/\/example\.com\/a\.png"/)
})

test("bare projections omit remote images without a media base", () => {
  const desktop = renderPreviewCore({
    source: "![Remote diagram](/diagram.svg)",
    kind: "document",
    title: "Diagram",
    workId: "work-id"
  })
  assert.doesNotMatch(desktop.html, /src="\/diagram\.svg"/)
})

test("the shared renderer does not invent a desktop asset protocol when no media base is supplied", () => {
  const digest = "a".repeat(64)
  const preview = renderPreviewCore({
    source: `![Missing](elef-asset:${digest})`,
    workId: "work-id"
  })

  assert.doesNotMatch(preview.html, /elefasset:\/\//)
})

test("shared Markdown block renderer supports both KaTeX delimiter families and autolinks", () => {
  const html = renderMarkdownBlock("Inline \\(\\bar{x}\\), display \\[x^2\\], and https://example.com")
  assert.match(html, /<span class="katex-display">/)
  assert.match(html, /href="https:\/\/example\.com"/)
})

test("bare projection carries no editor chrome, Stimulus hooks or controls", () => {
  const documentHtml = renderPreviewCore({
    kind: "document",
    source: "# Notes\n\nText.\n\n![Diagram](/diagram.svg)\n\n$x^2$"
  }).html
  const presentationHtml = renderPreviewCore({ source: "# One\n\nBody" }).html
  const blockHtml = renderMarkdownBlock("# Title\n\n![Alt](/a.png)\n\n$x$")

  for (const html of [documentHtml, presentationHtml, blockHtml]) {
    assert.doesNotMatch(html, /data-action/)
    assert.doesNotMatch(html, /data-controller/)
    assert.doesNotMatch(html, /contenteditable/)
    assert.doesNotMatch(html, /<button/)
    assert.doesNotMatch(html, /<select/)
    assert.doesNotMatch(html, /presentation-editor/)
    assert.doesNotMatch(html, /visual-editor/)
  }
})

test("the projection entry renders the bare default with no editor chrome", () => {
  const source = "# Title\n\n![Alt](/a.png)\n\n$x$"
  const html = renderProjectionBlock(source)

  assert.equal(html, renderMarkdownBlock(source))
  assert.doesNotMatch(html, /data-editor-/)
  assert.doesNotMatch(html, /contenteditable/)
  assert.doesNotMatch(html, /data-action/)
  assert.doesNotMatch(html, /visual-editor/)
})

test("shared Markdown rendering preserves styled transpose and inverse atoms", () => {
  for (const expression of ["\\mathbf{x}^{\\mathsf{T}}", "\\vec{x}^{\\mathsf{T}}", "\\mathbf{x}^{-1}", "\\vec{x}^{-1}"]) {
    const html = renderMarkdownBlock(`$${expression}$`)

    assert.match(html, /class="katex"/, `${expression} should render as math`)
    assert.doesNotMatch(html, /class="math-error"/, `${expression} should not produce a math error`)
  }
})

test("CRLF sources keep multi-line blocks editable in visual mode", () => {
  const seen: boolean[] = []
  const chrome: RendererChrome = {
    imageAttributes: () => "",
    mathAttributes: () => "",
    mediaFigure: ({ rendered }) => rendered,
    documentBlockAttributes: ({ valid }) => {
      seen.push(valid)
      return `data-valid="${valid}"`
    },
    documentBlockShell: ({ attributes, rendered }) => `<div ${attributes}>${rendered}</div>`,
    emptyDocumentBlock: () => "",
    positionControl: () => "",
    documentRoot: ({ inner }) => `<div>${inner}</div>`,
    presentationBlockAttributes: ({ valid }) => {
      seen.push(valid)
      return `data-valid="${valid}"`
    },
    presentationBlockControls: () => "",
    slideBlock: ({ attributes, content }) => `<div ${attributes}>${content}</div>`,
    emptySlide: () => "",
    slideToolbar: () => "",
    slideFrame: ({ content }) => `<section>${content}</section>`,
    presentationRoot: ({ inner }) => `<div>${inner}</div>`
  }
  // Single-line heading plus multi-line paragraph and list: the editor map
  // slices the raw CRLF source while the parsed blocks are LF-normalized,
  // so a strict markdown comparison would mark only the heading editable.
  const source = "# Title\r\n\r\nFirst line\r\nsecond line\r\n\r\n- one\r\n- two\r\n"

  renderPreviewCore({ kind: "document", source, title: "CRLF" }, { chrome })
  assert.deepEqual(seen, [true, true, true])

  seen.length = 0
  renderPreviewCore({ source, title: "CRLF" }, { chrome })
  assert.deepEqual(seen, [true, true, true])
})

test("ART-SRC-INVALID-PARITY: invalid Art is consumed with only its stable Art diagnostic", () => {
  const source = ":::art{flow}\n- A"
  const structure = buildEditorStructure(source, { sourceName: "invalid-art", mode: "document" })
  const preview = renderPreviewCore({ kind: "document", source, title: "Invalid Art" })

  assert.equal(structure.editorMap.slides[0]?.directives[0]?.type, "art_invalid")
  assert.deepEqual(structure.editorMap.art_diagnostics?.map((diagnostic) => diagnostic.code), ["ART_INVALID_SYNTAX"])
  assert.ok(structure.warnings.some((warning) => warning.includes("syntax is invalid")))
  assert.ok(structure.warnings.every((warning) => !warning.includes("Unknown or malformed presentation directive")))
  assert.doesNotMatch(preview.html, /:::art\{flow\}/)
  assert.doesNotMatch(preview.html, /data-elef-art-root/)
})
