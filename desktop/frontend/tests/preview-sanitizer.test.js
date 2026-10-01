import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { installSanitizedPreview } from "../src/preview-sanitizer.js"

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
