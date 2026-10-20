import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { configureEditorKind, enableVisualModeAfterPreview, enableVisualModeFromInstalledPreview, focusOpenedEditor, installPreviewHtml, renderEditorView, mountEditorHosts } from "@elef/editor-runtime/test-internals"

test("opening focuses the active editor presentation after resetting its source caret", () => {
  for (const editingMode of ["source", "visual"]) {
    const calls = []
    const editor = {
      editingMode,
      setSelectionRange(offset) { calls.push(["selection", offset]) },
      focus() { calls.push(["source-focus"]) },
      projectionController() { return { restoreCaret(offset) { calls.push(["rendered-caret", offset]); return true } } }
    }
    assert.equal(focusOpenedEditor(editor, editingMode), true)
    assert.deepEqual(calls, [["selection", 0], editingMode === "source" ? ["source-focus"] : ["rendered-caret", 0]])
  }
})

test("opening without a mapped visual passage never focuses the concealed source engine", () => {
  assert.equal(focusOpenedEditor(null, "visual"), false)
  for (const projection of [null, { restoreCaret() { return false } }]) {
    const editor = {
      editingMode: "visual", setSelectionRange() {},
      focus() { assert.fail("visual open focused the concealed source engine") },
      projectionController() { return projection }
    }
    assert.equal(focusOpenedEditor(editor, "visual"), false)
  }
})

function mount(config) {
  const { document } = parseHTML("<form><div id='mount'></div></form>")
  const root = renderEditorView(document.querySelector("#mount"), config)
  return { document, root }
}

test("Rails editor hosts hydrate once across repeated Turbo load notifications", () => {
  const { document } = parseHTML(`
    <form>
      <div data-editor-form-controllers="dirty preview autosave" data-editor-view-config='{"kind":"document","mode":"source","source":"# Shared"}'></div>
    </form>
  `)
  const host = document.querySelector("[data-editor-view-config]")

  mountEditorHosts(document)
  const firstRoot = host.querySelector(".editor-shell")
  const firstEditorField = host.querySelector(".source-field")
  mountEditorHosts(document)

  assert.equal(host.querySelectorAll(".editor-shell").length, 1)
  assert.equal(host.querySelector(".editor-shell"), firstRoot)
  assert.equal(host.querySelector(".source-field"), firstEditorField)
  assert.equal(document.querySelector("form").dataset.controller, "dirty preview autosave")
})

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
    previewHtml: "<section class='slide'>Rendered by the shared renderer</section>",
    editorMap: { slides: [{ id: "slide-1" }] },
    ids: {
      field: "presentation_source_field", source: "presentation_source", surface: "presentation_source_editor",
      label: "presentation_source_editor_label", saveState: "save-state", retrySave: "retry-save"
    }
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
  assert.equal(root.querySelector("[data-autosave-target='status']").id, "save-state")
  assert.equal(root.querySelector("[data-autosave-target='retry']").id, "retry-save")
  assert.equal(root.querySelector("[data-autosave-target='retry']").hasAttribute("data-action"), false)
})

test("quiet-save hosts render no save status, unsaved marker, or manual retry", () => {
  const { root } = mount({
    kind: "presentation",
    mode: "visual",
    source: "# Shared source",
    title: "Shared title",
    showTitle: true,
    showSubmit: false,
    showSaveStatus: false,
    persisted: false,
    ids: { field: "quiet_field", source: "quiet_source", surface: "quiet_editor", label: "quiet_label" }
  })

  assert.equal(root.querySelector("[data-autosave-target='status']"), null)
  assert.equal(root.querySelector("[data-autosave-target='retry']"), null)
  assert.equal(root.querySelector("#save-state"), null)
  assert.equal(root.querySelector("#retry-save"), null)
  assert.ok(root.querySelector("#conflict-dialog"))
})

test("Stable editor removes experimental controls and keeps literal double-bracket source", () => {
  const source = "# Keep this source\n\n[[unresolved directive]]"
  const { root } = mount({
    kind: "document",
    mode: "source",
    source,
    documentTitles: ["Other document"],
    showTitle: true,
    desktopFeatures: {
      visualEditing: false,
      presentationEditing: false,
      slideOverview: false,
      documentLinks: false
    }
  })
  const form = root.closest("form")

  assert.equal(root.querySelector("[data-editor-target='input']").value, source)
  assert.equal(root.querySelector("[data-editor-target='visualButton'], [data-editor-target='sourceButton']"), null)
  assert.equal(root.querySelector("[data-visual-editor-target='projection']"), null)
  assert.equal(root.querySelector(".presentation-editor-tools, .slide-overview"), null)
  assert.equal(root.querySelector("[data-document-link-palette-target], [data-action*='document-link-palette#']"), null)
  assert.doesNotMatch(form.dataset.controller || "", /visual-editor|slide-overview|document-link-palette/)
  assert.doesNotMatch(form.dataset.action || "", /visual-editor#projectionKeydown|slide-overview#/)
  assert.equal(root.querySelector("[data-editor-view-target='editingMode']").textContent, "Source")

  // Re-configuring over seeded actions (as the static desktop host carries)
  // deletes the excluded actions without touching the retained source.
  form.dataset.action = "input->slide-overview#sourceChanged keydown->visual-editor#projectionKeydown"
  configureEditorKind(root, "document", {
    documentLinksEnabled: false,
    visualEditingEnabled: false,
    presentationEditingEnabled: false,
    slideOverviewEnabled: false
  })
  assert.doesNotMatch(form.dataset.action || "", /visual-editor#projectionKeydown|slide-overview#/)
  assert.equal(root.querySelector("[data-editor-target='input']").value, source)
  assert.equal(root.querySelector("[data-editor-view-target='editingMode']").textContent, "Source")
})

test("Rails and desktop install previews through the same sanitized DOM sink", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const preview = document.querySelector("#preview")
  installPreviewHtml(preview, `
    <section class="document-reader" data-controller="document-pages mermaid-diagrams">
      <div class="document-surface" data-document-pages-target="surface">
        <div class="document-editor-block" data-action="input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur" onclick="run()">Safe content</div>
        <script>run()</script>
      </div>
    </section>`)

  const block = preview.querySelector(".document-editor-block")
  assert.equal(block.textContent, "Safe content")
  assert.equal(block.hasAttribute("onclick"), false)
  assert.equal(block.getAttribute("data-action"), "input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur")
  assert.equal(preview.querySelector("script"), null)
  assert.equal(preview.querySelector(".document-surface").getAttribute("data-document-pages-target"), "surface")
})

test("preview installs without a visual editor land read-only instead of disconnected-editable", () => {
  const { document } = parseHTML("<div id='managed' data-visual-editor-target='projection'></div><div id='unmanaged'></div>")
  const html = `
    <div class="document-editor-block" data-editor-region-id="r1" data-editor-block-id="b1" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true"><p>Text</p></div>
    <div class="slide-block" data-editor-block-id="b2" data-editor-region-id="r2" data-editor-source-editable="true" contenteditable="true" role="textbox" aria-label="Editable slide block" aria-multiline="true" spellcheck="true"><p>Slide</p></div>`

  installPreviewHtml(document.querySelector("#managed"), html)
  for (const block of document.querySelector("#managed").querySelectorAll("[data-editor-block-id]")) {
    assert.equal(block.getAttribute("contenteditable"), "true")
  }

  installPreviewHtml(document.querySelector("#unmanaged"), html)
  const blocks = document.querySelector("#unmanaged").querySelectorAll("[data-editor-block-id]")
  assert.equal(blocks.length, 2)
  for (const block of blocks) {
    assert.equal(block.getAttribute("contenteditable"), "false")
    assert.equal(block.getAttribute("aria-readonly"), "true")
    assert.equal(block.hasAttribute("role"), false)
    assert.equal(block.hasAttribute("aria-label"), false)
    assert.equal(block.hasAttribute("aria-multiline"), false)
    assert.equal(block.hasAttribute("spellcheck"), false)
  }
})

test("image preloads share pending requests, release head nodes, and retry after failure", () => {
  const { document, Event } = parseHTML("<html><head></head><body><div id='preview'></div></body></html>")
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document")
  Object.defineProperty(globalThis, "document", { configurable: true, value: document })
  const preview = document.querySelector("#preview")
  const html = '<img src="/assets/figure.svg"><img src="/assets/figure.svg"><img src="data:image/png;base64,AAAA"><img src="blob:local-image">'
  try {
    installPreviewHtml(preview, html)
    installPreviewHtml(preview, html)
    assert.equal(document.head.querySelectorAll('link[rel="preload"]').length, 1)
    const failed = document.head.querySelector("link")
    assert.equal(failed.getAttribute("as"), "image")
    assert.equal(failed.getAttribute("href"), "/assets/figure.svg")
    failed.dispatchEvent(new Event("error"))
    assert.equal(document.head.children.length, 0)
    installPreviewHtml(preview, html)
    assert.equal(document.head.children.length, 1)
    document.head.querySelector("link").dispatchEvent(new Event("load"))
    assert.equal(document.head.children.length, 0)
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous)
    else delete globalThis.document
  }
})

test("Stable source-only mounts render installed preview blocks read-only", () => {
  const { root } = mount({
    kind: "document",
    mode: "source",
    source: "# Notes",
    previewHtml: `<div class="document-editor-block" data-editor-region-id="r1" data-editor-block-id="b1" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true"><p>Text</p></div>`,
    desktopFeatures: {
      visualEditing: false,
      presentationEditing: false,
      slideOverview: false,
      documentLinks: false
    }
  })

  const block = root.querySelector("[data-preview-target='container'] [data-editor-block-id]")
  assert.equal(block.getAttribute("contenteditable"), "false")
  assert.equal(block.getAttribute("aria-readonly"), "true")
  assert.equal(block.hasAttribute("role"), false)
  assert.equal(block.textContent, "Text")
})

test("shared editor view owns one conflict dialog with disk, local, and merge choices", () => {
  const { root } = mount({ kind: "presentation", mode: "source", persisted: true })
  const dialog = root.querySelector("#conflict-dialog")

  assert.ok(dialog)
  assert.equal(dialog.tagName, "DIALOG")
  assert.equal(dialog.getAttribute("aria-describedby"), "conflict-message")
  assert.ok(dialog.querySelector("#conflict-local"))
  assert.ok(dialog.querySelector("#conflict-disk"))
  assert.ok(dialog.querySelector("#conflict-merge"))
  assert.ok(dialog.querySelector("#use-disk-version"))
  assert.ok(dialog.querySelector("#keep-local-version"))
  assert.ok(dialog.querySelector("#save-merged-version"))
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

test("shared view writes work text as text and disables document links in presentations", () => {
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

test("switching work kinds updates the shared editor controls and controller targets", () => {
  const { document, root } = mount({ kind: "presentation", mode: "source" })
  const form = document.querySelector("form")

  configureEditorKind(root, "document", {
    documentTitles: ["Meeting notes"],
    showTitle: true,
    formControllers: "preview visual-editor presentation-host slide-overview media"
  })

  assert.equal(form.dataset.visualEditorKindValue, "document")
  assert.match(form.dataset.action, /(?:^|\s)keydown->visual-editor#projectionKeydown(?:$|\s)/)
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
  assert.equal(form.dataset.controller, "preview visual-editor presentation-host slide-overview media")

  configureEditorKind(root, "presentation", { showTitle: true })

  assert.equal(form.dataset.visualEditorKindValue, "presentation")
  assert.doesNotMatch(form.dataset.action, /keydown->visual-editor#projectionKeydown/)
  assert.equal(root.getAttribute("aria-label"), "Visual presentation editor")
  assert.equal(root.querySelector("[data-editor-view-target='kindBadge']").textContent, "Presentation")
  assert.equal(root.querySelector("[data-editor-view-target='titleField']").hidden, false)
  assert.equal(sourceInput.name, "presentation[source]")
  assert.doesNotMatch(sourceField.dataset.controller, /document-link-palette/)
  assert.equal(sourceField.dataset.documentLinkPaletteTitlesValue, undefined)
  assert.equal(sourceField.dataset.presentationEditorTarget, "source")
  assert.equal(sourceInput.dataset.documentLinkPaletteTarget, undefined)
  assert.doesNotMatch(sourceInput.dataset.action, /document-link-palette/)
  assert.equal(root.querySelector("[data-editor-view-target='mediaInput']").getAttribute("accept"), "image/*,video/mp4")
  assert.equal(root.querySelector("[data-editor-view-target='slideOverview']").hidden, false)
  assert.equal(root.querySelector("[data-presentation-editor-target='status']").hidden, false)
})

test("a successful preview enables visual mode even when the original refresh call returned early", () => {
  const { root } = mount({ kind: "presentation", mode: "source", visualDisabled: true })
  const button = root.querySelector("[data-editor-target='visualButton']")

  assert.equal(button.disabled, true)
  assert.equal(enableVisualModeAfterPreview(root, { response: { ok: true }, payload: { html: "" } }), true)
  assert.equal(button.disabled, false)
  assert.equal(button.title, "Edit the rendered Work visually")
})

test("failed or incomplete previews leave visual mode disabled", () => {
  const { root } = mount({ kind: "presentation", mode: "source", visualDisabled: true })
  const button = root.querySelector("[data-editor-target='visualButton']")

  assert.equal(enableVisualModeAfterPreview(root, { response: { ok: false }, payload: { html: "<p>partial</p>" } }), false)
  assert.equal(enableVisualModeAfterPreview(root, { response: { ok: true }, payload: { html: null } }), false)
  assert.equal(button.disabled, true)
})

test("a controller connecting after preview installation restores the visual mode control", () => {
  const { root } = mount({ kind: "presentation", mode: "visual", visualDisabled: true })
  const projection = root.querySelector("[data-preview-target='container']")
  projection.append(root.ownerDocument.createElement("article"))
  root.previewController = { projectionFresh: true }

  assert.equal(enableVisualModeFromInstalledPreview(root), true)
  assert.equal(root.querySelector("[data-editor-target='visualButton']").disabled, false)
})

test("an absent or stale installed preview does not enable visual mode", () => {
  const { root } = mount({ kind: "presentation", mode: "visual", visualDisabled: true })
  root.previewController = { projectionFresh: true }
  assert.equal(enableVisualModeFromInstalledPreview(root), false)

  root.querySelector("[data-preview-target='container']").append(root.ownerDocument.createElement("article"))
  root.previewController.projectionFresh = false
  assert.equal(enableVisualModeFromInstalledPreview(root), false)
  assert.equal(root.querySelector("[data-editor-target='visualButton']").disabled, true)
})
