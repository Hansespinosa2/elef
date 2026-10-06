import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { renderPreview } from "../../../app/javascript/lib/renderer.js"
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

test("interactive preview keeps renderer-owned alignment controls and drops unknown actions", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  installSanitizedPreview(container, `
    <label data-action="pointerdown->visual-editor#positionControlOpened">
      <select data-visual-editor-block-id="block-1" data-action="focus->visual-editor#positionControlOpened keydown->visual-editor#positionControlKeydown change->visual-editor#alignmentChanged">
        <option value="left">Left</option><option value="center">Center</option>
      </select>
    </label>
    <select data-presentation-editor-align data-slide-index="0" data-block-index="1" data-action="change->presentation-editor#alignmentChanged"></select>
    <button data-presentation-editor-action="move-block-up" data-slide-index="0" data-block-index="1">Move up</button>
    <select data-visual-editor-block-id="bad id" data-action="change->hostile#invoke"></select>
    <button data-presentation-editor-action="invoke" data-slide-index="-1" data-block-index="not-an-index">Bad action</button>`)

  const visualLabel = container.querySelector("label")
  const visualAlignment = container.querySelector("[data-visual-editor-block-id='block-1']")
  const presentationAlignment = container.querySelector("[data-presentation-editor-align]")
  const presentationMove = container.querySelector("[data-presentation-editor-action='move-block-up']")
  const hostileControls = [...container.querySelectorAll("select")].filter(control => !control.dataset.visualEditorBlockId && !control.hasAttribute("data-presentation-editor-align"))
  const invalidAction = container.querySelector("button:not([data-presentation-editor-action='move-block-up'])")

  assert.equal(visualLabel.getAttribute("data-action"), "pointerdown->visual-editor#positionControlOpened")
  assert.equal(visualAlignment.getAttribute("data-action"), "focus->visual-editor#positionControlOpened keydown->visual-editor#positionControlKeydown change->visual-editor#alignmentChanged")
  assert.equal(presentationAlignment.getAttribute("data-action"), "change->presentation-editor#alignmentChanged")
  assert.equal(presentationAlignment.dataset.slideIndex, "0")
  assert.equal(presentationAlignment.dataset.blockIndex, "1")
  assert.equal(presentationMove.dataset.slideIndex, "0")
  assert.equal(presentationMove.dataset.blockIndex, "1")
  assert.equal(hostileControls[0].hasAttribute("data-action"), false)
  assert.equal(hostileControls[0].hasAttribute("data-visual-editor-block-id"), false)
  assert.equal(invalidAction.hasAttribute("data-presentation-editor-action"), false)
  assert.equal(invalidAction.hasAttribute("data-slide-index"), false)
  assert.equal(invalidAction.hasAttribute("data-block-index"), false)
})

test("sanitized renderer output retains the document and presentation editing controls", () => {
  for (const kind of ["document", "presentation"]) {
    const { document } = parseHTML("<main id='preview'></main>")
    const container = document.querySelector("#preview")
    const rendered = renderPreview({ source: "# Title\n\nA paragraph.", kind }).html
    installSanitizedPreview(container, rendered)

    if (kind === "presentation") {
      assert.ok(container.querySelector("button[data-presentation-editor-action]"), "presentation actions remain available")
    }
    const alignment = container.querySelector("select[data-visual-editor-block-id], select[data-presentation-editor-align]")
    assert.ok(alignment, `${kind} alignment control remains available`)
    assert.ok(alignment.querySelector('option[value="left"]'), `${kind} alignment options retain values`)
  }
})

test("sanitized renderer output preserves safe Markdown table alignment", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  const rendered = renderPreview({ source: "| Left | Right |\n| :--- | ---: |\n| one | two |" }).html
  installSanitizedPreview(container, rendered)

  assert.equal(container.querySelector("th").getAttribute("style"), "text-align:left")
  assert.equal(container.querySelector("th:nth-child(2)").getAttribute("style"), "text-align:right")
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
