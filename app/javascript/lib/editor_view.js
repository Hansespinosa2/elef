import { installSanitizedPreview } from "#elef/preview-sanitizer"

const EDITOR_VIEW = `
  <section class="editor-shell" aria-label="Visual editor">
    <header class="editor-shell-header">
      <div class="editor-title-field" data-editor-view-target="titleField" hidden>
        <label class="editor-title-label" data-editor-view-target="titleLabel">Title</label>
        <input class="editor-title-input" autocomplete="off" data-editor-view-target="title" data-dirty-target="field" data-autosave-target="field" data-action="input->dirty#markDirty input->autosave#schedule">
      </div>
      <div class="editor-kind-badge" data-editor-view-target="kindBadge"></div>
    </header>

    <div class="editor-layout">
      <div class="source-pane">
        <div class="field source-field relative mb-4" data-editor-view-target="sourceField">
          <label class="sr-only" data-editor-view-target="sourceLabel">Markdown source</label>
          <div class="editor-toolbar" aria-label="Editor controls">
            <div class="editor-mode-switch" role="group" aria-label="Editing mode">
              <button type="button" class="editor-mode-button" data-editor-target="visualButton" data-action="click->editor#showVisual">Visual</button>
              <button type="button" class="editor-mode-button" data-editor-target="sourceButton" data-action="click->editor#showSource">Source</button>
              <span class="editor-editing-mode" data-editor-target="editingMode" data-editor-view-target="editingMode" aria-live="polite"></span>
            </div>
            <span class="editor-mode" data-editor-target="mode" data-mode="standard" aria-live="polite">Standard</span>
            <span class="editor-command" data-editor-target="command" aria-live="polite"></span>
            <details class="editor-settings appearance-settings" data-controller="appearance" data-appearance-target="panelContainer">
              <summary class="editor-reveal-metadata">Appearance</summary>
              <div class="editor-settings-panel appearance-fields" aria-label="Visual appearance controls">
                <div data-appearance-target="themeField">
                  <label class="appearance-label mb-1 block font-extrabold" data-editor-view-target="themeLabel">Theme</label>
                  <select class="appearance-select w-full rounded-xl p-3" data-appearance-target="theme" data-dirty-target="field" data-autosave-target="field" data-action="change->dirty#markDirty change->autosave#schedule">
                    <option value="">Workspace default</option><option value="light">Light</option><option value="dark">Dark</option><option value="match">Match</option>
                  </select>
                </div>
                <div data-appearance-target="typographyField">
                  <label class="appearance-label mb-1 block font-extrabold" data-editor-view-target="typographyLabel">Typography</label>
                  <select class="appearance-select w-full rounded-xl p-3" data-appearance-target="typography" data-dirty-target="field" data-autosave-target="field" data-action="change->dirty#markDirty change->autosave#schedule">
                    <option value="">Workspace default</option><option value="book">Book</option><option value="modern">Modern</option><option value="technical">Technical</option>
                  </select>
                </div>
                <p class="field-hint appearance-hint" data-appearance-target="hint">Appearance overrides stay in the Markdown front matter.</p>
              </div>
            </details>
            <button type="button" class="editor-reveal-metadata" data-editor-target="metadataToggle" data-action="editor#toggleMetadataVisibility">Reveal source metadata</button>
          </div>

          <div class="media-editor-controls mb-3 flex flex-wrap items-center gap-2" aria-label="Media controls">
            <button type="button" class="button secondary" data-action="media#choose" data-editor-view-target="mediaButton">Add image</button>
            <label class="media-fit-control">Fit
              <select data-media-target="fit"><option value="contain">Contain</option><option value="cover">Cover</option></select>
            </label>
            <input type="file" hidden data-media-target="input" data-action="change->media#selected" data-editor-view-target="mediaInput">
            <span class="media-upload-status" data-media-target="status" role="status" aria-live="polite" aria-busy="false"></span>
          </div>

          <div class="editor-surface" data-editor-target="surface" data-snippet-palette-target="editor" data-math-shorthand-target="editor" data-math-shortcut-palette-target="editor" data-document-link-palette-target="editor" data-action="dragover->media#sourceDragOver:capture dragleave->media#sourceDragLeave drop->media#sourceDrop:capture"></div>
          <textarea rows="24" class="editor-input-proxy" spellcheck="false" tabindex="-1" aria-label="Markdown source" data-editor-target="input" data-dirty-target="field" data-autosave-target="field" data-snippet-palette-target="editor" data-math-shorthand-target="editor" data-math-shortcut-palette-target="editor" data-document-link-palette-target="editor" data-action="input->dirty#markDirty input->snippet-palette#input keydown->snippet-palette#keydown keydown->math-shorthand#keydown input->math-shortcut-palette#input keydown->math-shortcut-palette#keydown input->mermaid-assist#input input->document-link-palette#input keydown->document-link-palette#keydown"></textarea>
          <div class="snippet-palette" data-snippet-palette-target="palette" hidden role="listbox" aria-label="Snippet suggestions"></div>
          <div class="snippet-palette math-shortcut-palette" data-math-shortcut-palette-target="palette" hidden role="listbox" aria-label="Math shortcut suggestions"></div>
          <div class="snippet-palette" data-mermaid-assist-target="palette" hidden role="listbox" aria-label="Mermaid suggestions"></div>
          <div class="snippet-palette" data-document-link-palette-target="palette" hidden role="listbox" aria-label="Document link suggestions"></div>
          <p class="field-hint editor-mode-hint">Visual mode keeps Markdown source canonical. Use Source mode for unsupported syntax, inline media, or to edit LaTeX expressions directly. Type <code>/trigger</code> for document structures and <code>:align</code> or <code>:footnote</code> for Elef directives. Type <code>[[</code> to link another document. In math, type <code>@a</code>, <code>@frac</code>, or <code>@gather</code>; Tab walks multi-slot expressions. Type <code>/diagram</code> to open Mermaid Assist. Math transforms such as <code>$x.b.vec.t$</code> commit with Enter or Tab.</p>
        </div>

        <div class="presentation-editor-tools" aria-label="Presentation editing tools" data-editor-view-target="presentationTools">
          <span class="presentation-editor-help">Edit slide text directly. Use the controls on each slide for structure and positioning.</span>
        </div>
        <section class="slide-overview" aria-labelledby="slide-overview-heading" data-editor-view-target="slideOverview">
          <div class="slide-overview-heading-row">
            <div><h3 data-editor-view-target="slideHeading">Slide overview</h3><p data-slide-overview-target="count" aria-live="polite">0 slides</p></div>
            <div class="slide-overview-actions" aria-label="Slide actions">
              <button type="button" data-action="slide-overview#add" aria-label="Add slide after selected">Add</button>
              <button type="button" data-action="slide-overview#duplicate" aria-label="Duplicate selected slide">Duplicate</button>
              <button type="button" data-action="slide-overview#delete" aria-label="Delete selected slide">Delete</button>
              <button type="button" data-action="slide-overview#moveUp" aria-label="Move selected slide earlier">↑</button>
              <button type="button" data-action="slide-overview#moveDown" aria-label="Move selected slide later">↓</button>
            </div>
          </div>
          <div class="slide-overview-grid" data-slide-overview-target="grid" role="group" aria-label="Slides"></div>
          <section class="slide-overflow-warnings" data-slide-overview-target="warnings" aria-label="Slide overflow warnings" role="status" hidden><h4>Overflow warnings</h4><ul></ul></section>
        </section>
      </div>

      <script type="application/json" data-editor-map-json></script>
      <div class="editor-projection preview-pane" data-visual-editor-target="projection" data-preview-target="container" data-presentation-target="stage" aria-label="Visual editing surface" data-action="dragover->media#dragOver dragleave->media#dragLeave drop->media#drop" tabindex="-1"></div>
    </div>

    <section class="preview-warnings rounded-xl border border-[#e7c56d] bg-[#fff8df] p-3 text-[#765700]" data-preview-target="warnings" aria-label="Preview warnings" hidden><h3 class="mb-1 text-sm font-bold">Preview warnings</h3><ul class="list-disc pl-5 text-sm"></ul></section>
    <div class="editor-footer">
      <div class="editor-actions">
        <button type="submit" class="button primary" data-dirty-target="saveButton" data-editor-view-target="saveButton">Save</button>
        <a class="button" data-editor-view-target="previewLink" data-dirty-navigation="true" hidden>Preview</a>
        <span class="dirty-state" data-autosave-target="status" aria-live="polite">Saved</span>
        <button type="button" class="autosave-retry" data-autosave-target="retry" data-action="autosave#retry" hidden>Retry save</button>
        <span class="release-state" data-editor-view-target="releaseState" hidden></span>
        <span class="dirty-state" data-preview-target="status" aria-live="polite"></span>
        <button type="button" class="preview-retry" data-preview-target="retry" data-action="preview#retry" hidden>Retry preview</button>
      </div>
      <span class="presentation-editor-status" data-presentation-editor-target="status" aria-live="polite"></span>
    </div>
    <dialog id="conflict-dialog" class="conflict-dialog" data-autosave-target="conflict" aria-labelledby="conflict-title" aria-describedby="conflict-message">
      <div class="conflict-content">
        <p class="conflict-eyebrow">EXTERNAL CHANGE</p>
        <h2 id="conflict-title">This deck changed elsewhere</h2>
        <p id="conflict-message" class="conflict-explanation" data-autosave-target="conflictMessage">A newer version is active; your draft was preserved.</p>
        <div class="conflict-columns">
          <section><h3>Your edits</h3><pre id="conflict-local" class="conflict-source" data-autosave-target="localSource"></pre></section>
          <section><h3>Current version · <span id="conflict-source-name"></span></h3><pre id="conflict-disk" class="conflict-source" data-autosave-target="serverSource"></pre></section>
        </div>
        <label class="merge-label" for="conflict-merge">Merged Markdown</label>
        <textarea id="conflict-merge" class="conflict-merge" spellcheck="false" aria-label="Merged Markdown version" data-autosave-target="mergeSource"></textarea>
        <div class="dialog-actions conflict-actions">
          <button id="use-disk-version" class="button secondary" type="button" data-conflict-resolution="disk">Use current version</button>
          <button id="save-merged-version" class="button secondary" type="button" data-conflict-resolution="merge">Save merged version</button>
          <button id="keep-local-version" class="button primary" type="button" data-conflict-resolution="local">Keep my edits</button>
        </div>
      </div>
    </dialog>
  </section>
`

const TARGET = "[data-editor-view-target]"

export function installPreviewHtml(container, html) {
  const mediaBaseUrl = container.closest("form")?.dataset.mediaAssetBaseUrlValue || ""
  installSanitizedPreview(container, html, { mediaBaseUrl })
}

export function mountEditorHosts(root = globalThis.document) {
  if (!root) return
  const hosts = root.querySelectorAll("[data-editor-view-config]")
  for (const host of hosts) {
    if (host.dataset.editorViewMounted === "true") continue
    const config = JSON.parse(host.dataset.editorViewConfig)
    renderEditorView(host, config)
    const form = host.closest("form")
    if (form && host.dataset.editorFormControllers) form.dataset.controller = host.dataset.editorFormControllers
    host.dataset.editorViewMounted = "true"
  }
}

export function renderEditorView(container, config) {
  if (!container?.ownerDocument) throw new TypeError("Editor view needs a DOM container")
  if (!config || !["document", "presentation"].includes(config.kind)) throw new TypeError("Editor view needs a supported deck kind")

  const doc = container.ownerDocument
  const template = doc.createElement("template")
  template.innerHTML = EDITOR_VIEW
  const root = template.content.querySelector(".editor-shell")
  const get = name => root.querySelector(`${TARGET}[data-editor-view-target~="${name}"]`)
  const label = config.kind === "document" ? "Document" : "Presentation"
  const ids = config.ids || {}

  get("title").setAttribute("value", config.title || "")
  if (ids.title) get("title").id = ids.title
  if (config.titleName) get("title").name = config.titleName
  get("titleLabel").setAttribute("for", ids.title || "elef-editor-title")
  if (ids.title) get("title").id = ids.title

  const sourceField = root.querySelector(".source-field")
  sourceField.id = ids.field || "elef-editor-field"
  sourceField.dataset.editorInitialSourceValue = JSON.stringify(config.source || "")
  sourceField.dataset.authoringRegistry = JSON.stringify(config.authoringRegistry || [])

  const sourceLabel = get("sourceLabel")
  sourceLabel.textContent = "Markdown source"
  sourceLabel.id = ids.label || `${ids.surface || ids.source || "elef-source"}_label`
  sourceLabel.setAttribute("for", ids.source || "elef-source")

  const sourceSurface = root.querySelector("[data-editor-target='surface']")
  sourceSurface.id = ids.surface || `${ids.source || "elef-source"}_editor`
  sourceSurface.setAttribute("aria-labelledby", sourceLabel.id)
  for (const target of ["snippet-palette", "math-shorthand", "math-shortcut-palette"]) {
    sourceSurface.dataset[`${target.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}Target`] = "editor"
  }
  const sourceInput = root.querySelector("[data-editor-target='input']")
  sourceInput.id = ids.source || "elef-source"
  sourceInput.textContent = config.source || ""
  if (config.sourceName) sourceInput.name = config.sourceName
  for (const [name, suffix, options] of [
    ["snippet-palette", "snippet_palette", "snippet-palette"],
    ["math-shortcut-palette", "math_shortcut_palette", "math-shortcut-palette"],
    ["mermaid-assist", "mermaid_assist_palette", "mermaid-assist"],
    ["document-link-palette", "document_link_palette", "document-link-palette"]
  ]) {
    const palette = root.querySelector(`[data-${options}-target="palette"]`)
    palette.id = `${ids.surface || ids.source || "elef-source"}_${suffix}`
  }

  get("themeLabel").setAttribute("for", ids.theme || "elef-theme")
  const theme = root.querySelector("[data-appearance-target='theme']")
  theme.id = ids.theme || "elef-theme"
  if (config.themeName) theme.name = config.themeName
  selectValue(theme, config.theme || "")
  get("typographyLabel").setAttribute("for", ids.typography || "elef-typography")
  const typography = root.querySelector("[data-appearance-target='typography']")
  typography.id = ids.typography || "elef-typography"
  if (config.typographyName) typography.name = config.typographyName
  selectValue(typography, config.typography || "")

  const visualButton = root.querySelector("[data-editor-target='visualButton']")
  const sourceButton = root.querySelector("[data-editor-target='sourceButton']")
  if (ids.visualMode) visualButton.id = ids.visualMode
  if (ids.sourceMode) sourceButton.id = ids.sourceMode
  const mode = config.mode === "source" ? "source" : "visual"
  setPressed(visualButton, mode === "visual")
  setPressed(sourceButton, mode === "source")
  visualButton.disabled = Boolean(config.visualDisabled)
  if (config.visualDisabled) visualButton.title = config.visualDisabledMessage || "Visual preview is not ready"
  get("editingMode").textContent = mode === "visual" ? "Visual" : "Source"
  const form = container.closest("form")
  if (form) form.dataset.editorMode = mode
  root.querySelector(".appearance-settings").hidden = mode !== "visual"
  root.querySelector("[data-editor-target='metadataToggle']").hidden = mode === "visual"
  get("slideHeading").id = ids.slideHeading || "slide-overview-heading"
  root.querySelector(".slide-overview").setAttribute("aria-labelledby", get("slideHeading").id)
  const slideCount = root.querySelector("[data-slide-overview-target='count']")
  const count = Number(config.slideCount) || 0
  slideCount.textContent = `${count} ${count === 1 ? "slide" : "slides"}`

  const map = root.querySelector("[data-editor-map-json]")
  map.textContent = JSON.stringify(config.editorMap || {})
  const projection = root.querySelector("[data-preview-target='container']")
  projection.id = ids.preview || "elef-editor-preview"
  projection.setAttribute("aria-label", mode === "visual" ? "Visual editing surface" : "Rendered preview")
  installPreviewHtml(projection, config.previewHtml || "")
  renderWarnings(root.querySelector("[data-preview-target='warnings'] ul"), config.warnings || [])
  root.querySelector("[data-preview-target='warnings']").hidden = !config.warnings?.length

  const saveButton = get("saveButton")
  saveButton.textContent = `Save ${label.toLowerCase()}`
  saveButton.hidden = config.showSubmit === false
  const saveStatus = root.querySelector('[data-autosave-target="status"]')
  if (ids.saveState) saveStatus.id = ids.saveState
  const retryButton = root.querySelector('[data-autosave-target="retry"]')
  if (ids.retrySave) {
    retryButton.id = ids.retrySave
    retryButton.removeAttribute("data-action")
  }
  get("previewLink").hidden = !config.previewUrl
  if (config.previewUrl) get("previewLink").href = config.previewUrl
  const persisted = Boolean(config.persisted)
  root.querySelector("[data-autosave-target='retry']").hidden = !persisted
  get("releaseState").hidden = !config.releaseState
  if (config.releaseState) {
    get("releaseState").dataset.releaseStatus = config.releaseStatus || ""
    get("releaseState").textContent = config.releaseState
  }
  container.replaceChildren(template.content)
  const mountedRoot = container.querySelector(".editor-shell")
  configureEditorKind(mountedRoot, config.kind, {
    documentTitles: config.documentTitles,
    sourceName: config.sourceName,
    showTitle: config.showTitle
  })
  return mountedRoot
}

export function configureEditorKind(root, kind, { documentTitles = [], sourceName, showTitle = false, formControllers } = {}) {
  if (!root?.querySelector) throw new TypeError("Editor kind needs a rendered editor view")
  if (!["document", "presentation"].includes(kind)) throw new TypeError("Editor view needs a supported deck kind")

  const isDocument = kind === "document"
  const sourceField = root.querySelector(".source-field")
  const sourceSurface = root.querySelector("[data-editor-target='surface']")
  const sourceInput = root.querySelector("[data-editor-target='input']")
  const controllerNames = ["editor", "snippet-palette", "math-shorthand", "math-shortcut-palette", "mermaid-assist"]
  const documentLinkActions = ["input->document-link-palette#input", "keydown->document-link-palette#keydown"]

  root.setAttribute("aria-label", `Visual ${kind} editor`)
  root.querySelector('[data-editor-view-target="kindBadge"]').textContent = isDocument ? "Document" : "Presentation"
  root.querySelector('[data-editor-view-target="titleField"]').hidden = isDocument || !showTitle
  sourceField.dataset.controller = [...controllerNames, ...(isDocument ? ["document-link-palette"] : [])].join(" ")
  sourceField.dataset.documentLinkPaletteTitlesValue = JSON.stringify(documentTitles)
  sourceInput.name = sourceName || `${kind}[source]`

  const actions = new Set((sourceInput.dataset.action || "").split(/\s+/).filter(Boolean))
  for (const action of documentLinkActions) actions.delete(action)
  if (isDocument) {
    sourceSurface.dataset.documentLinkPaletteTarget = "editor"
    sourceInput.dataset.documentLinkPaletteTarget = "editor"
    documentLinkActions.forEach(action => actions.add(action))
    delete sourceField.dataset.presentationEditorTarget
  } else {
    delete sourceSurface.dataset.documentLinkPaletteTarget
    delete sourceInput.dataset.documentLinkPaletteTarget
    sourceField.dataset.presentationEditorTarget = "source"
  }
  sourceInput.dataset.action = [...actions].join(" ")

  root.querySelector(".editor-mode-hint").textContent = isDocument
    ? "Visual mode keeps Markdown source canonical. Use Source mode for unsupported syntax or to edit LaTeX expressions directly. Type [[ to link another document. In math, type @a, @frac, or @gather; Tab walks multi-slot expressions. Type /diagram to open Mermaid Assist."
    : "Visual mode keeps Markdown source canonical. Use Source mode for unsupported syntax, inline media, or to edit LaTeX expressions directly. Type /trigger for document structures and :align or :footnote for Elef directives. In math, type @a, @frac, or @gather; Tab walks multi-slot expressions. Type /diagram to open Mermaid Assist. Math transforms such as $x.b.vec.t$ commit with Enter or Tab."
  root.querySelector('[data-editor-view-target="mediaButton"]').textContent = isDocument ? "Add image" : "Add image or MP4"
  root.querySelector('[data-editor-view-target="mediaInput"]').setAttribute("accept", isDocument ? "image/*" : "image/*,video/mp4")
  root.querySelector('[data-editor-view-target="presentationTools"]').hidden = isDocument
  root.querySelector('[data-editor-view-target="slideOverview"]').hidden = isDocument
  root.querySelector("[data-presentation-editor-target='status']").hidden = isDocument

  const form = root.closest("form")
  if (form) {
    form.dataset.visualEditorKindValue = kind
    const formActions = new Set((form.dataset.action || "").split(/\s+/).filter(Boolean))
    const projectionKeydown = "keydown->visual-editor#projectionKeydown"
    formActions.delete(projectionKeydown)
    if (isDocument) formActions.add(projectionKeydown)
    form.dataset.action = [...formActions].join(" ")
    if (formControllers !== undefined) form.dataset.controller = formControllers
  }
  return root
}

export function enableVisualModeAfterPreview(root, detail) {
  if (!detail?.response?.ok || typeof detail.payload?.html !== "string") return false
  return enableVisualMode(root)
}

export function enableVisualModeFromInstalledPreview(root) {
  const preview = root?.previewController
  const projection = root?.querySelector?.("[data-preview-target='container']")
  if (preview?.projectionFresh !== true || !projection?.childElementCount) return false
  return enableVisualMode(root)
}

function enableVisualMode(root) {
  const button = root?.querySelector?.("[data-editor-target='visualButton']")
  if (!button) return false
  button.disabled = false
  button.title = "Edit the rendered deck visually"
  return true
}

function setPressed(button, pressed) {
  button.classList.toggle("is-active", pressed)
  button.setAttribute("aria-pressed", String(pressed))
}

function selectValue(select, value) {
  for (const option of select.querySelectorAll("option")) {
    if (option.value === value) option.setAttribute("selected", "")
    else option.removeAttribute("selected")
  }
}

function renderWarnings(list, warnings) {
  list.replaceChildren(...warnings.map(warning => {
    const item = list.ownerDocument.createElement("li")
    item.textContent = String(warning)
    return item
  }))
}
