import assert from "node:assert/strict"
import test from "node:test"
import { renderPreviewCore } from "@elef/renderer"
import { editorChrome } from "@elef/editor-runtime/editor-chrome"

const renderPreview = input => renderPreviewCore(input, { chrome: editorChrome })

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
