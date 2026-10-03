import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { installSanitizedPreview } from "../src/preview-sanitizer.js"
import { renderPreview } from "../src/renderer.js"

test("preview sink strips executable markup and remote image sources while preserving editor controls", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  installSanitizedPreview(container, `
    <section data-controller="document-pages mermaid-diagrams">
      <div class="document-editor-block" data-editor-block-id="b1" contenteditable="true" onclick="invoke('delete_deck')" data-action="input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur">
        <img src="https://example.com/remote.png" onerror="invoke('delete_deck')">
        <img src="elefasset://localhost/id/sha" data-editor-image-source="true">
        <script>invoke('delete_deck')</script>
        <a href="javascript:alert(1)">bad</a>
      </div>
    </section>`)

  const section = container.querySelector("section")
  const block = container.querySelector("[data-editor-block-id]")
  assert.equal(section.getAttribute("data-controller"), "document-pages mermaid-diagrams")
  assert.equal(block.getAttribute("contenteditable"), "true")
  assert.equal(block.getAttribute("onclick"), null)
  assert.equal(container.querySelector("script"), null)
  assert.equal(container.querySelector("img[src^='https://']"), null)
  assert.equal(container.querySelector("img[src^='elefasset:']").getAttribute("src"), "elefasset://localhost/id/sha")
  assert.equal(container.querySelector("a").getAttribute("href"), null)
})

test("non-interactive library previews remove controller and editing hooks", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  installSanitizedPreview(container, `
    <section data-controller="mermaid-diagrams">
      <div contenteditable="true" data-action="input->visual-editor#projectionInput">safe text</div>
    </section>`, { interactive: false })

  assert.equal(container.querySelector("section").getAttribute("data-controller"), null)
  assert.equal(container.querySelector("[contenteditable]"), null)
  assert.equal(container.querySelector("[data-action]"), null)
  assert.equal(container.textContent.trim(), "safe text")
})

test("sanitizing shared presentation output keeps the actual editing controls", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  const preview = renderPreview({ source: "# Plan\n\nA slide block." })

  installSanitizedPreview(container, preview.html)

  assert.ok(container.querySelector("button[data-presentation-editor-action='add-slide-after']"))
  assert.ok(container.querySelector("button[data-presentation-editor-action='add-block-after']"))
  assert.ok(container.querySelector("select[data-presentation-editor-align]"))
  assert.equal(container.querySelector("select[data-presentation-editor-align]").getAttribute("data-action"), "change->presentation-editor#alignmentChanged")
  assert.ok(container.querySelector("option[value='center']"))
})

test("sanitizing shared document output keeps the editable media caption and local asset", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  const preview = renderPreview({
    kind: "document",
    deckId: "notes-id",
    source: "# Notes\n\n![Diagram](elef-asset:" + "a".repeat(64) + ")"
  })

  installSanitizedPreview(container, preview.html)

  assert.ok(container.querySelector("figure.editor-media"))
  assert.equal(container.querySelector("figcaption.editor-media-caption").textContent, "Diagram")
  assert.equal(container.querySelector("img").getAttribute("src"), `elefasset://localhost/notes-id/${"a".repeat(64)}`)
})
