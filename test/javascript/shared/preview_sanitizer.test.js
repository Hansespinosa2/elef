import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { installSanitizedPreview } from "../../../app/javascript/lib/preview_sanitizer.js"

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

test("preview sink keeps sanitized deck media inside editable figure captions", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  installSanitizedPreview(container, `
    <figure class="editor-media" onclick="invoke('delete_deck')">
      <img src="elefasset://localhost/id/sha" data-editor-image-source="true" onerror="invoke('delete_deck')">
      <figcaption class="editor-media-caption" aria-label="Editable image alt text">Diagram</figcaption>
    </figure>`)

  const figure = container.querySelector("figure")
  const image = figure?.querySelector("img")
  const caption = figure?.querySelector("figcaption")
  assert.equal(figure?.getAttribute("onclick"), null)
  assert.equal(image?.getAttribute("src"), "elefasset://localhost/id/sha")
  assert.equal(image?.getAttribute("onerror"), null)
  assert.equal(caption?.textContent, "Diagram")
  assert.equal(caption?.getAttribute("aria-label"), "Editable image alt text")
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

test("non-interactive document cards preserve only the trusted page controller and its surface target", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  installSanitizedPreview(container, `
    <div class="document-reader document-theme-dark" data-controller="document-pages mermaid-diagrams">
      <div class="document-surface" data-document-pages-target="surface">
        <p>Page content</p>
        <div class="hostile" data-controller="file-library" data-document-pages-target="surface">Injected controller</div>
        <div class="document-reader" data-controller="document-pages mermaid-diagrams">
          <div class="document-surface" data-document-pages-target="surface">Nested injected pagination</div>
        </div>
      </div>
    </div>`, { interactive: false, documentPagination: true })

  const reader = container.querySelector(".document-reader")
  const surface = container.querySelector(".document-surface")
  const hostile = container.querySelector(".hostile")
  assert.equal(reader.getAttribute("data-controller"), "document-pages mermaid-diagrams")
  assert.equal(surface.getAttribute("data-document-pages-target"), "surface")
  assert.equal(hostile.getAttribute("data-controller"), null)
  assert.equal(hostile.getAttribute("data-document-pages-target"), null)
  assert.equal(container.querySelectorAll("[data-controller]").length, 1)
  assert.equal(container.querySelectorAll("[data-document-pages-target]").length, 1)
})

test("non-document library previews cannot activate document pagination", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  installSanitizedPreview(container, `
    <div class="document-reader" data-controller="document-pages mermaid-diagrams">
      <div class="document-surface" data-document-pages-target="surface">Presentation text</div>
    </div>`, { interactive: false })

  assert.equal(container.querySelector("[data-controller]"), null)
  assert.equal(container.querySelector("[data-document-pages-target]"), null)
})
