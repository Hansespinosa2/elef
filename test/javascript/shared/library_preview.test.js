import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { createLibraryPreviewLoader } from "../../../app/javascript/lib/library_preview.js"
import { installSanitizedPreview } from "../../../app/javascript/lib/preview_sanitizer.js"

test("library canvases reuse web sizing while retaining only the trusted read-only controller", async () => {
  for (const kind of ["document", "presentation"]) {
    const { document } = parseHTML("<div id='preview'></div>")
    const container = document.querySelector("#preview")
    const html = kind === "document"
      ? '<div class="document-reader document-editor-projection" data-controller="visual-editor"><div class="document-surface" contenteditable="true">Notes</div></div>'
      : '<div class="presentation-surface presentation-editor-projection" data-controller="presentation-editor"><div class="slide" contenteditable="true">Slides</div></div>'
    const load = createLibraryPreviewLoader({ readPreview: async () => ({ source: "# Notes" }), render: async () => ({ html }), install: installSanitizedPreview })
    assert.equal(await load(container, { id: "fixture", name: "Notes", kind }), true)
    assert.equal(container.dataset.controller, "presentation-canvas")
    assert.equal(container.querySelector("[data-controller], [contenteditable], [data-action]"), null)
    const canvas = container.querySelector('[data-presentation-canvas-target="canvas"]')
    assert.ok(canvas)
    if (kind === "document") {
      assert.equal(container.dataset.presentationCanvasDesignWidthValue, "794")
      assert.equal(container.dataset.presentationCanvasDesignHeightValue, "1123")
      assert.ok(canvas.classList.contains("library-preview-page"))
    }
  }
})

test("library previews use the shared renderer and the non-interactive sanitizer", async () => {
  const { document } = parseHTML("<div id='preview'></div>")
  const container = document.querySelector("#preview")
  const calls = []
  const load = createLibraryPreviewLoader({
    readPreview: async id => {
      calls.push(["read", id])
      return { source: "# Notes", source_file: "document.md" }
    },
    render: async input => {
      calls.push(["render", input])
      return { html: "<h1>Notes</h1>" }
    },
    install: (target, html, options) => calls.push(["install", target, html, options])
  })

  assert.equal(await load(container, { id: "doc-1", name: "Notes", kind: "document" }), true)
  assert.equal(container.dataset.previewState, "ready")
  assert.equal(container.getAttribute("inert"), "")
  assert.deepEqual(calls[0], ["read", "doc-1"])
  assert.deepEqual(calls[1][1], {
    source: "# Notes",
    kind: "document",
    title: "Notes",
    deckId: "doc-1",
    mediaBaseUrl: "elefasset://localhost/doc-1",
    documentNodes: []
  })
  assert.equal(calls[2][2], "<h1>Notes</h1>")
  assert.deepEqual(calls[2][3], { interactive: false })
})

test("large sources show a bounded-preview message without invoking the renderer", async () => {
  const { document } = parseHTML("<div id='preview'></div>")
  const container = document.querySelector("#preview")
  let rendered = false
  const load = createLibraryPreviewLoader({
    readPreview: async () => { throw Object.assign(new Error("large"), { code: "too_large" }) },
    render: async () => { rendered = true; return { html: "" } },
    install() {}
  })

  assert.equal(await load(container, { id: "doc-1", kind: "document" }), false)
  assert.equal(container.textContent, "Preview unavailable for large source files.")
  assert.equal(container.dataset.previewState, "unavailable")
  assert.equal(rendered, false)
})
