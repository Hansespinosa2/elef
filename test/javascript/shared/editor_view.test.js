import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { configureEditorKind, renderEditorView } from "../../../app/javascript/lib/editor_view.js"

function mount(config) {
  const { document } = parseHTML("<form><div id='mount'></div></form>")
  const root = renderEditorView(document.querySelector("#mount"), config)
  return { document, root }
}

test("shared editor view exposes the same editing controls and targets to both hosts", () => {
  const { document, root } = mount({
    kind: "presentation",
    mode: "visual",
    source: "# Shared source",
    title: "Shared title",
    showTitle: true,
    sourceName: "presentation[source]",
    titleName: "presentation[title]",
    themeName: "presentation[theme]",
    typographyName: "presentation[typography]",
    theme: "dark",
    typography: "book",
    persisted: true,
    showSubmit: true,
    slideCount: 3,
    previewHtml: "<article class='slide'>Rendered by the shared renderer</article>",
    editorMap: { slides: [{ id: "slide-1" }] },
    ids: { field: "presentation_source_field", source: "presentation_source", surface: "presentation_source_editor", label: "presentation_source_editor_label" }
  })

  assert.ok(root.querySelector(".editor-toolbar"))
  assert.ok(root.querySelector(".editor-layout .source-pane"))
  assert.ok(root.querySelector(".editor-projection.preview-pane"))
  assert.ok(root.querySelector(".slide-overview"))
  assert.equal(root.querySelector("#presentation_source").value, "# Shared source")
  assert.equal(root.querySelector("#presentation_source").name, "presentation[source]")
  assert.equal(root.querySelector("#presentation_source_editor").getAttribute("aria-labelledby"), "presentation_source_editor_label")
  assert.equal(root.querySelector("[data-appearance-target='theme']").value, "dark")
  assert.equal(root.querySelector("[data-appearance-target='typography']").value, "book")
  assert.equal(root.querySelector("[data-slide-overview-target='count']").textContent, "3 slides")
  assert.equal(document.querySelector(".visual-editor-form"), null)
  assert.equal(root.querySelector(".editor-projection").textContent, "Rendered by the shared renderer")
  assert.equal(root.querySelector("[data-editor-map-json]").textContent, '{"slides":[{"id":"slide-1"}]}')
  assert.equal(root.querySelector("[data-editor-target='visualButton']").getAttribute("aria-pressed"), "true")
  assert.equal(root.querySelector("[data-editor-target='sourceButton']").getAttribute("aria-pressed"), "false")
})

test("shared editor view configures document-only links and media controls", () => {
  const { root } = mount({
    kind: "document",
    mode: "source",
    source: "# Notes",
    sourceName: "document[source]",
    documentTitles: ["A note"],
    showSubmit: true,
    warnings: ["A <script> payload is displayed as text"]
  })

  assert.ok(root.querySelector("[data-controller~='document-link-palette']"))
  assert.ok(root.querySelector("[data-document-link-palette-target='palette']"))
  assert.equal(root.querySelector("[data-editor-view-target='mediaInput']").getAttribute("accept"), "image/*")
  assert.equal(root.querySelector(".slide-overview").hidden, true)
  assert.equal(root.querySelector(".presentation-editor-tools").hidden, true)
  assert.equal(root.querySelector("[data-editor-view-target='kindBadge']").textContent, "Document")
  assert.equal(root.querySelector("#elef-source").name, "document[source]")
  assert.equal(root.querySelector("[data-preview-target='warnings'] li").textContent, "A <script> payload is displayed as text")
  assert.equal(root.querySelector("[data-editor-target='sourceButton']").getAttribute("aria-pressed"), "true")
})

test("shared view writes deck text as text and disables document links in presentations", () => {
  const { root } = mount({
    kind: "presentation",
    mode: "source",
    source: "<img src=x onerror=alert(1)>",
    warnings: ["<script>not markup</script>"]
  })

  assert.equal(root.querySelector("[data-editor-target='input']").value, "<img src=x onerror=alert(1)>")
  assert.equal(root.querySelector("[data-preview-target='warnings'] li").textContent, "<script>not markup</script>")
  assert.equal(root.querySelector(".source-field").dataset.controller.includes("document-link-palette"), false)
  assert.ok(root.querySelector("[data-document-link-palette-target='palette']"))
  assert.equal(root.querySelector("[data-editor-view-target='mediaInput']").getAttribute("accept"), "image/*,video/mp4")
})

test("switching deck kinds updates the shared editor controls and controller targets", () => {
  const { document, root } = mount({ kind: "presentation", mode: "source" })
  const form = document.querySelector("form")

  configureEditorKind(root, "document", {
    documentTitles: ["Meeting notes"],
    showTitle: true,
    formControllers: "preview visual-editor presentation-editor slide-overview media presentation"
  })

  const sourceField = root.querySelector(".source-field")
  const sourceInput = root.querySelector("[data-editor-target='input']")
  assert.equal(root.getAttribute("aria-label"), "Visual document editor")
  assert.equal(root.querySelector("[data-editor-view-target='kindBadge']").textContent, "Document")
  assert.equal(root.querySelector("[data-editor-view-target='titleField']").hidden, true)
  assert.equal(sourceInput.name, "document[source]")
  assert.match(sourceField.dataset.controller, /document-link-palette/)
  assert.equal(sourceField.dataset.documentLinkPaletteTitlesValue, '["Meeting notes"]')
  assert.equal(sourceField.dataset.presentationEditorTarget, undefined)
  assert.equal(sourceInput.dataset.documentLinkPaletteTarget, "editor")
  assert.match(sourceInput.dataset.action, /input->document-link-palette#input/)
  assert.equal(root.querySelector("[data-editor-view-target='mediaInput']").getAttribute("accept"), "image/*")
  assert.equal(root.querySelector("[data-editor-view-target='slideOverview']").hidden, true)
  assert.equal(root.querySelector("[data-presentation-editor-target='status']").hidden, true)
  assert.match(form.dataset.controller, /presentation/)

  configureEditorKind(root, "presentation", { showTitle: true })

  assert.equal(root.getAttribute("aria-label"), "Visual presentation editor")
  assert.equal(root.querySelector("[data-editor-view-target='kindBadge']").textContent, "Presentation")
  assert.equal(root.querySelector("[data-editor-view-target='titleField']").hidden, false)
  assert.equal(sourceInput.name, "presentation[source]")
  assert.doesNotMatch(sourceField.dataset.controller, /document-link-palette/)
  assert.equal(sourceField.dataset.documentLinkPaletteTitlesValue, "[]")
  assert.equal(sourceField.dataset.presentationEditorTarget, "source")
  assert.equal(sourceInput.dataset.documentLinkPaletteTarget, undefined)
  assert.doesNotMatch(sourceInput.dataset.action, /document-link-palette/)
  assert.equal(root.querySelector("[data-editor-view-target='mediaInput']").getAttribute("accept"), "image/*,video/mp4")
  assert.equal(root.querySelector("[data-editor-view-target='slideOverview']").hidden, false)
  assert.equal(root.querySelector("[data-presentation-editor-target='status']").hidden, false)
})
