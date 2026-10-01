import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { createLibraryPreviewLoader } from "../src/library-preview.js"

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
