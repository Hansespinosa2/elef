// packages/editor-runtime/src/lib/authoring_registry_merge.ts
import { POSITION_VOCABULARY } from "@elef/work-model/document-map";
function registryKey(entry) {
  return JSON.stringify([entry.namespace || "", String(entry.id)]);
}
var LEGACY_DIRECTIVE_TRIGGERS = /* @__PURE__ */ new Map([
  ["sse", "section"],
  ["sss", "subsection"],
  ["foot", "footnote"]
]);
var DIRECTIVE_SCHEMAS = /* @__PURE__ */ new Map([
  ["align", {
    grammar: ["alignment_or_position", "vertical_position?"],
    argument_count: { minimum: 1, maximum: 2 },
    values: [
      [...POSITION_VOCABULARY.horizontal, ...POSITION_VOCABULARY.vertical],
      [...POSITION_VOCABULARY.vertical]
    ]
  }],
  ["section", { grammar: ["text"], argument_count: 1, values: [] }],
  ["subsection", { grammar: ["text"], argument_count: 1, values: [] }],
  ["footnote", { grammar: ["text"], argument_count: 1, values: [] }]
]);
function placeholders(template) {
  return [...String(template || "").matchAll(/\$\{(\d+)(?::([^}]*))?\}/g)].map(([, position, label = ""]) => ({ position: Number(position), label }));
}
function editorSnippet(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.body !== "string" || typeof entry.trigger !== "string") {
    return entry;
  }
  const sourceTrigger = entry.trigger;
  const trigger = LEGACY_DIRECTIVE_TRIGGERS.get(sourceTrigger) || sourceTrigger;
  const aliases = [.../* @__PURE__ */ new Set([
    ...Array.isArray(entry.aliases) ? entry.aliases : [],
    ...trigger === sourceTrigger ? [] : [sourceTrigger]
  ])];
  const namespace = entry.namespace || (entry.category === "Elef DSL" ? ":" : "/");
  const template = entry.body;
  const name = String(entry.name || "");
  const description = String(entry.description || "");
  return {
    ...entry,
    namespace,
    trigger,
    aliases,
    search_terms: [trigger, ...aliases, name, description].filter(Boolean),
    contexts: entry.category === "LaTeX" && !/^\s*\$/.test(template) ? ["math"] : ["source"],
    behavior: {
      type: "insert",
      template,
      placeholders: placeholders(template)
    },
    commit_behavior: "accept_palette_selection",
    documentation_example: `${namespace}${trigger} \u2192 ${template}`,
    argument_schema: namespace === ":" ? DIRECTIVE_SCHEMAS.get(trigger) || { grammar: ["free_text"] } : null
  };
}
function editorMathShortcut(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.expansion !== "string" || !Array.isArray(entry.aliases)) {
    return entry;
  }
  const prefix = String(entry.prefix || "@");
  const aliases = entry.aliases;
  const template = entry.expansion;
  const name = String(entry.name || "");
  const description = String(entry.description || "");
  const transform = prefix === ".";
  return {
    ...entry,
    prefix,
    namespace: entry.namespace || prefix,
    trigger: entry.trigger || aliases[0] || "",
    search_terms: [name, ...aliases, description].filter(Boolean),
    contexts: ["math"],
    commit_behavior: transform ? ["space", "tab", "enter", "cursor_leaves_chain", "editor_blur", "save"] : "accept_palette_selection",
    documentation_example: `${prefix}${aliases[0] || ""} \u2192 ${template}`,
    behavior: {
      type: transform ? "transform" : "insert",
      template,
      placeholders: placeholders(template),
      operator_class: null,
      accepted_operand: transform ? "atomic_math_object" : null,
      serializer: template
    }
  };
}
function mergeAuthoringRegistryEntries(builtInEntries, snippetEntries = [], mathShortcutEntries = []) {
  const entries = /* @__PURE__ */ new Map();
  for (const entry of builtInEntries) {
    if (entry && (typeof entry.id === "string" || typeof entry.id === "number")) {
      entries.set(registryKey(entry), entry);
    }
  }
  const customEntries = [
    ...snippetEntries.map(editorSnippet),
    ...mathShortcutEntries.map(editorMathShortcut)
  ];
  for (const entry of customEntries) {
    if (!entry || entry.built_in === true || typeof entry.id !== "string" && typeof entry.id !== "number") continue;
    entries.set(registryKey(entry), entry);
  }
  return [...entries.values()];
}

// packages/editor-runtime/src/lib/client_mounts.ts
var MOUNT_CONTROLLERS = {
  mermaid: "mermaid-diagrams",
  "document-pages": "document-pages"
};
function clientMountController(token) {
  return MOUNT_CONTROLLERS[token] ?? null;
}
function translateElementMounts(element) {
  const mounts = (element.getAttribute?.("data-client-mount") || "").split(/\s+/).filter(Boolean);
  const controllers = mounts.flatMap((mount) => clientMountController(mount) ?? []);
  if (!controllers.length) return false;
  const existing = (element.getAttribute("data-controller") || "").split(/\s+/).filter(Boolean);
  controllers.forEach((identifier) => {
    if (!existing.includes(identifier)) existing.push(identifier);
  });
  element.setAttribute("data-controller", existing.join(" "));
  return true;
}
function translateClientMounts(root) {
  if (!root?.querySelectorAll) return 0;
  let translated = 0;
  if (root.hasAttribute?.("data-client-mount") && translateElementMounts(root)) translated += 1;
  root.querySelectorAll("[data-client-mount]").forEach((element) => {
    if (translateElementMounts(element)) translated += 1;
  });
  return translated;
}
var startedTargets = /* @__PURE__ */ new WeakSet();
function startClientMounts(target = globalThis.document ?? null) {
  if (!target || typeof MutationObserver === "undefined" || startedTargets.has(target)) return false;
  startedTargets.add(target);
  translateClientMounts(target);
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        if (mutation.attributeName === "data-client-mount" && mutation.target.nodeType === 1) {
          translateElementMounts(mutation.target);
        }
        return;
      }
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        translateClientMounts(node);
      });
    });
  }).observe(target.documentElement ?? target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-client-mount"]
  });
  return true;
}

// packages/editor-runtime/src/lib/conflict_dialog.ts
function presentConflictDialog(dialog, {
  message = "",
  localSource = "",
  diskSource = "",
  diskSourceFile = "",
  mergeSource = localSource
} = {}) {
  if (!dialog) return false;
  const text = (selector, value) => {
    const element = dialog.querySelector(selector);
    if (element) element.textContent = value == null ? "" : String(value);
  };
  text("#conflict-message", message);
  text("#conflict-local", localSource);
  text("#conflict-disk", diskSource);
  text("#conflict-source-name", diskSourceFile);
  const merge = dialog.querySelector("#conflict-merge");
  if (merge) merge.value = mergeSource == null ? "" : String(mergeSource);
  if (!dialog.open) dialog.showModal();
  return true;
}

// packages/editor-runtime/src/lib/editor_controller_lookup.ts
function editorFor(element) {
  return element?.editorController || null;
}

// packages/editor-runtime/src/lib/editor_ready.ts
function waitForEditorController(field, findController, { timeoutMs = 5e3 } = {}) {
  const available = findController(field);
  if (available?.editorReady === true) return Promise.resolve(available);
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      field.removeEventListener("elef:editor-ready", onReady);
    };
    const onReady = () => {
      cleanup();
      const controller = findController(field);
      if (controller?.editorReady === true) resolve(controller);
      else reject(editorUnavailable());
    };
    field.addEventListener("elef:editor-ready", onReady, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(editorUnavailable());
    }, timeoutMs);
  });
}
function editorUnavailable() {
  return Object.assign(new Error("The editor did not finish loading. Try closing and reopening this deck."), {
    code: "editor_unavailable",
    retryable: true
  });
}

// packages/editor-runtime/src/lib/editor_source.ts
async function applyEditorSource(source, {
  id,
  expectedSource,
  getDeckId,
  getSource,
  waitForEditor,
  setFallback,
  materializeEdits = () => {
  }
}) {
  const controller = await waitForEditor();
  materializeEdits();
  if (getDeckId() !== id || getSource() !== expectedSource) return false;
  if (controller) controller.setExternalValue(source);
  else setFallback(source);
  return true;
}

// packages/editor-runtime/src/lib/editor_view.ts
import { sanitizePreview as installSanitizedPreview } from "@elef/client/sanitize";
var EDITOR_VIEW = `
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
              <button type="button" data-action="slide-overview#moveUp" aria-label="Move selected slide earlier">\u2191</button>
              <button type="button" data-action="slide-overview#moveDown" aria-label="Move selected slide later">\u2193</button>
            </div>
          </div>
          <div class="slide-overview-grid" data-slide-overview-target="grid" role="group" aria-label="Slides"></div>
          <section class="slide-overflow-warnings" data-slide-overview-target="warnings" aria-label="Slide overflow warnings" role="status" hidden><h4>Overflow warnings</h4><ul></ul></section>
        </section>
      </div>

      <script type="application/json" data-editor-map-json><\/script>
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
          <section><h3>Current version \xB7 <span id="conflict-source-name"></span></h3><pre id="conflict-disk" class="conflict-source" data-autosave-target="serverSource"></pre></section>
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
`;
var TARGET = "[data-editor-view-target]";
function installPreviewHtml(container, html) {
  const mediaBaseUrl = container.closest("form")?.dataset.mediaAssetBaseUrlValue || "";
  installSanitizedPreview(container, html, { mediaBaseUrl });
}
function mountEditorHosts(root = globalThis.document) {
  if (!root) return;
  const hosts = root.querySelectorAll("[data-editor-view-config]");
  for (const host of hosts) {
    if (host.dataset.editorViewMounted === "true") continue;
    const config = JSON.parse(host.dataset.editorViewConfig);
    renderEditorView(host, config);
    const form = host.closest("form");
    if (form && host.dataset.editorFormControllers) form.dataset.controller = host.dataset.editorFormControllers;
    host.dataset.editorViewMounted = "true";
  }
}
function renderEditorView(container, config) {
  if (!container?.ownerDocument) throw new TypeError("Editor view needs a DOM container");
  if (!config || !["document", "presentation"].includes(config.kind)) throw new TypeError("Editor view needs a supported deck kind");
  const doc = container.ownerDocument;
  const template = doc.createElement("template");
  template.innerHTML = EDITOR_VIEW;
  const root = template.content.querySelector(".editor-shell");
  const get = (name) => root.querySelector(`${TARGET}[data-editor-view-target~="${name}"]`);
  const label = config.kind === "document" ? "Document" : "Presentation";
  const ids = config.ids || {};
  get("title").setAttribute("value", config.title || "");
  if (ids.title) get("title").id = ids.title;
  if (config.titleName) get("title").name = config.titleName;
  get("titleLabel").setAttribute("for", ids.title || "elef-editor-title");
  if (ids.title) get("title").id = ids.title;
  const sourceField = root.querySelector(".source-field");
  sourceField.id = ids.field || "elef-editor-field";
  sourceField.dataset.editorInitialSourceValue = JSON.stringify(config.source || "");
  sourceField.dataset.authoringRegistry = JSON.stringify(config.authoringRegistry || []);
  const sourceLabel = get("sourceLabel");
  sourceLabel.textContent = "Markdown source";
  sourceLabel.id = ids.label || `${ids.surface || ids.source || "elef-source"}_label`;
  sourceLabel.setAttribute("for", ids.source || "elef-source");
  const sourceSurface = root.querySelector("[data-editor-target='surface']");
  sourceSurface.id = ids.surface || `${ids.source || "elef-source"}_editor`;
  sourceSurface.setAttribute("aria-labelledby", sourceLabel.id);
  for (const target of ["snippet-palette", "math-shorthand", "math-shortcut-palette"]) {
    sourceSurface.dataset[`${target.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}Target`] = "editor";
  }
  const sourceInput = root.querySelector("[data-editor-target='input']");
  sourceInput.id = ids.source || "elef-source";
  sourceInput.textContent = config.source || "";
  if (config.sourceName) sourceInput.name = config.sourceName;
  for (const [name, suffix, options] of [
    ["snippet-palette", "snippet_palette", "snippet-palette"],
    ["math-shortcut-palette", "math_shortcut_palette", "math-shortcut-palette"],
    ["mermaid-assist", "mermaid_assist_palette", "mermaid-assist"],
    ["document-link-palette", "document_link_palette", "document-link-palette"]
  ]) {
    const palette = root.querySelector(`[data-${options}-target="palette"]`);
    palette.id = `${ids.surface || ids.source || "elef-source"}_${suffix}`;
  }
  get("themeLabel").setAttribute("for", ids.theme || "elef-theme");
  const theme = root.querySelector("[data-appearance-target='theme']");
  theme.id = ids.theme || "elef-theme";
  if (config.themeName) theme.name = config.themeName;
  selectValue(theme, config.theme || "");
  get("typographyLabel").setAttribute("for", ids.typography || "elef-typography");
  const typography = root.querySelector("[data-appearance-target='typography']");
  typography.id = ids.typography || "elef-typography";
  if (config.typographyName) typography.name = config.typographyName;
  selectValue(typography, config.typography || "");
  const visualButton = root.querySelector("[data-editor-target='visualButton']");
  const sourceButton = root.querySelector("[data-editor-target='sourceButton']");
  if (ids.visualMode) visualButton.id = ids.visualMode;
  if (ids.sourceMode) sourceButton.id = ids.sourceMode;
  const mode = config.mode === "source" ? "source" : "visual";
  setPressed(visualButton, mode === "visual");
  setPressed(sourceButton, mode === "source");
  visualButton.disabled = Boolean(config.visualDisabled);
  if (config.visualDisabled) visualButton.title = config.visualDisabledMessage || "Visual preview is not ready";
  get("editingMode").textContent = mode === "visual" ? "Visual" : "Source";
  const form = container.closest("form");
  if (form) form.dataset.editorMode = mode;
  root.querySelector(".appearance-settings").hidden = mode !== "visual";
  root.querySelector("[data-editor-target='metadataToggle']").hidden = mode === "visual";
  get("slideHeading").id = ids.slideHeading || "slide-overview-heading";
  root.querySelector(".slide-overview").setAttribute("aria-labelledby", get("slideHeading").id);
  const slideCount = root.querySelector("[data-slide-overview-target='count']");
  const count = Number(config.slideCount) || 0;
  slideCount.textContent = `${count} ${count === 1 ? "slide" : "slides"}`;
  const map = root.querySelector("[data-editor-map-json]");
  map.textContent = JSON.stringify(config.editorMap || {});
  const projection = root.querySelector("[data-preview-target='container']");
  projection.id = ids.preview || "elef-editor-preview";
  projection.setAttribute("aria-label", mode === "visual" ? "Visual editing surface" : "Rendered preview");
  installPreviewHtml(projection, config.previewHtml || "");
  renderWarnings(root.querySelector("[data-preview-target='warnings'] ul"), config.warnings || []);
  root.querySelector("[data-preview-target='warnings']").hidden = !config.warnings?.length;
  const saveButton = get("saveButton");
  saveButton.textContent = `Save ${label.toLowerCase()}`;
  saveButton.hidden = config.showSubmit === false;
  const saveStatus = root.querySelector('[data-autosave-target="status"]');
  if (ids.saveState) saveStatus.id = ids.saveState;
  const retryButton = root.querySelector('[data-autosave-target="retry"]');
  if (ids.retrySave) {
    retryButton.id = ids.retrySave;
    retryButton.removeAttribute("data-action");
  }
  get("previewLink").hidden = !config.previewUrl;
  if (config.previewUrl) get("previewLink").href = config.previewUrl;
  const persisted = Boolean(config.persisted);
  root.querySelector("[data-autosave-target='retry']").hidden = !persisted;
  if (config.showSaveStatus === false) {
    saveStatus.remove();
    retryButton.remove();
  }
  get("releaseState").hidden = !config.releaseState;
  if (config.releaseState) {
    get("releaseState").dataset.releaseStatus = config.releaseStatus || "";
    get("releaseState").textContent = config.releaseState;
  }
  container.replaceChildren(template.content);
  const mountedRoot = container.querySelector(".editor-shell");
  configureEditorKind(mountedRoot, config.kind, {
    documentTitles: config.documentTitles,
    sourceName: config.sourceName,
    showTitle: config.showTitle
  });
  return mountedRoot;
}
function configureEditorKind(root, kind, { documentTitles = [], sourceName, showTitle = false, formControllers } = {}) {
  if (!root?.querySelector) throw new TypeError("Editor kind needs a rendered editor view");
  if (!["document", "presentation"].includes(kind)) throw new TypeError("Editor view needs a supported deck kind");
  const isDocument = kind === "document";
  const sourceField = root.querySelector(".source-field");
  const sourceSurface = root.querySelector("[data-editor-target='surface']");
  const sourceInput = root.querySelector("[data-editor-target='input']");
  const controllerNames = ["editor", "snippet-palette", "math-shorthand", "math-shortcut-palette", "mermaid-assist"];
  const documentLinkActions = ["input->document-link-palette#input", "keydown->document-link-palette#keydown"];
  root.setAttribute("aria-label", `Visual ${kind} editor`);
  root.querySelector('[data-editor-view-target="kindBadge"]').textContent = isDocument ? "Document" : "Presentation";
  root.querySelector('[data-editor-view-target="titleField"]').hidden = isDocument || !showTitle;
  sourceField.dataset.controller = [...controllerNames, ...isDocument ? ["document-link-palette"] : []].join(" ");
  sourceField.dataset.documentLinkPaletteTitlesValue = JSON.stringify(documentTitles);
  sourceInput.name = sourceName || `${kind}[source]`;
  const actions = new Set((sourceInput.dataset.action || "").split(/\s+/).filter(Boolean));
  for (const action of documentLinkActions) actions.delete(action);
  if (isDocument) {
    sourceSurface.dataset.documentLinkPaletteTarget = "editor";
    sourceInput.dataset.documentLinkPaletteTarget = "editor";
    documentLinkActions.forEach((action) => actions.add(action));
    delete sourceField.dataset.presentationEditorTarget;
  } else {
    delete sourceSurface.dataset.documentLinkPaletteTarget;
    delete sourceInput.dataset.documentLinkPaletteTarget;
    sourceField.dataset.presentationEditorTarget = "source";
  }
  sourceInput.dataset.action = [...actions].join(" ");
  root.querySelector(".editor-mode-hint").textContent = isDocument ? "Visual mode keeps Markdown source canonical. Use Source mode for unsupported syntax or to edit LaTeX expressions directly. Type [[ to link another document. In math, type @a, @frac, or @gather; Tab walks multi-slot expressions. Type /diagram to open Mermaid Assist." : "Visual mode keeps Markdown source canonical. Use Source mode for unsupported syntax, inline media, or to edit LaTeX expressions directly. Type /trigger for document structures and :align or :footnote for Elef directives. In math, type @a, @frac, or @gather; Tab walks multi-slot expressions. Type /diagram to open Mermaid Assist. Math transforms such as $x.b.vec.t$ commit with Enter or Tab.";
  root.querySelector('[data-editor-view-target="mediaButton"]').textContent = isDocument ? "Add image" : "Add image or MP4";
  root.querySelector('[data-editor-view-target="mediaInput"]').setAttribute("accept", isDocument ? "image/*" : "image/*,video/mp4");
  root.querySelector('[data-editor-view-target="presentationTools"]').hidden = isDocument;
  root.querySelector('[data-editor-view-target="slideOverview"]').hidden = isDocument;
  root.querySelector("[data-presentation-editor-target='status']").hidden = isDocument;
  if (formControllers !== void 0) {
    const form = root.closest("form");
    if (form) form.dataset.controller = formControllers;
  }
  return root;
}
function enableVisualModeAfterPreview(root, detail) {
  if (!detail?.response?.ok || typeof detail.payload?.html !== "string") return false;
  return enableVisualMode(root);
}
function enableVisualModeFromInstalledPreview(root) {
  const preview = root?.previewController;
  const projection = root?.querySelector?.("[data-preview-target='container']");
  if (preview?.projectionFresh !== true || !projection?.childElementCount) return false;
  return enableVisualMode(root);
}
function enableVisualMode(root) {
  const button = root?.querySelector?.("[data-editor-target='visualButton']");
  if (!button) return false;
  button.disabled = false;
  button.title = "Edit the rendered deck visually";
  return true;
}
function setPressed(button, pressed) {
  button.classList.toggle("is-active", pressed);
  button.setAttribute("aria-pressed", String(pressed));
}
function selectValue(select, value) {
  for (const option of select.querySelectorAll("option")) {
    if (option.value === value) option.setAttribute("selected", "");
    else option.removeAttribute("selected");
  }
}
function renderWarnings(list, warnings) {
  list.replaceChildren(...warnings.map((warning) => {
    const item = list.ownerDocument.createElement("li");
    item.textContent = String(warning);
    return item;
  }));
}

// packages/editor-runtime/src/lib/renderer_worker.ts
function renderWorkerMessage(data, renderPreview, renderMarkdownBlock = renderPreview) {
  const { id, input } = data || {};
  try {
    const result = input?.kind === "markdown-block" ? renderMarkdownBlock(input.source) : renderPreview(input);
    return { id, result };
  } catch (error) {
    const failure = error;
    return {
      id,
      error: {
        code: typeof failure?.code === "string" ? failure.code : "render_error",
        message: typeof failure?.message === "string" ? failure.message : "Preview could not be rendered.",
        retryable: failure?.retryable === true
      }
    };
  }
}

// packages/editor-runtime/src/controllers/mermaid_runtime.ts
function mermaidAssetUrl() {
  const importmap = document.querySelector('script[type="importmap"]');
  if (importmap) {
    try {
      const mappedUrl = JSON.parse(importmap.textContent).imports?.mermaid;
      if (mappedUrl) return mappedUrl;
    } catch {
    }
  }
  return document.querySelector('meta[name="elef-mermaid-url"]')?.content || null;
}

// packages/editor-runtime/src/lib/deck_open_flow.ts
function createDeckOpenFlow(open) {
  let previous = Promise.resolve();
  return (id) => {
    const request = previous.then(() => open(id));
    previous = request.catch(() => {
    });
    return request;
  };
}
async function prepareDeckOpen(id, { read, prepare, isDirty, flushSave, getRevision = () => void 0 }) {
  let target = id;
  while (true) {
    const revision = getRevision();
    const deck = await read(target);
    const prepared = await prepare(deck);
    if (isDirty()) {
      if (!await flushSave()) return null;
    } else if (getRevision() === revision) {
      return { deck, prepared, revision };
    }
    target = deck.id;
  }
}

// packages/editor-runtime/src/lib/document_graph_cache.ts
function createDocumentGraphCache(loadGraph) {
  let generation = 0;
  let cachedGraph = null;
  let inFlight = null;
  async function get() {
    while (true) {
      if (cachedGraph) return cachedGraph;
      const requestGeneration = generation;
      let request = inFlight;
      if (!request || request.generation !== requestGeneration) {
        request = {
          generation: requestGeneration,
          promise: Promise.resolve().then(loadGraph)
        };
        inFlight = request;
      }
      try {
        const graph = await request.promise;
        if (requestGeneration !== generation) continue;
        cachedGraph = graph;
        return graph;
      } catch (error) {
        if (requestGeneration !== generation) continue;
        throw error;
      } finally {
        if (inFlight === request) inFlight = null;
      }
    }
  }
  function invalidate() {
    generation += 1;
    cachedGraph = null;
  }
  return Object.freeze({ get, invalidate });
}

// packages/editor-runtime/src/lib/editor_actions.ts
function editorActionControl(event, action) {
  const control = event.target?.closest?.(`[data-editor-action="${action}"]`);
  return control ?? null;
}
function bindEditorAction(root, action, handler, { events = ["click"] } = {}) {
  const listener = (event) => {
    const control = editorActionControl(event, action);
    if (!control || !root.contains(control)) return;
    handler(event, control);
  };
  events.forEach((type) => root.addEventListener(type, listener));
  return () => events.forEach((type) => root.removeEventListener(type, listener));
}

// packages/editor-runtime/src/lib/editor_binding.ts
function createCodeMirrorBinding({
  getEditor,
  getDeckId,
  getFallbackValue,
  setFallbackValue,
  waitForEditor,
  materializeEdits = () => {
  }
}) {
  function getText() {
    return getEditor()?.sourceValue ?? getFallbackValue();
  }
  function setText(source, { id = getDeckId(), expectedSource = getText() } = {}) {
    return applyEditorSource(source, {
      id,
      expectedSource,
      getDeckId,
      getSource: getText,
      waitForEditor,
      setFallback: setFallbackValue,
      materializeEdits
    });
  }
  return { getText, setText, materializeEdits };
}

// packages/editor-runtime/src/lib/editor_document_state.ts
function createDocumentState(EditorState, source, extensions = []) {
  const lineSeparator = source.match(/\r\n|\r|\n/)?.[0] || "\n";
  return {
    lineSeparator,
    state: EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of(lineSeparator), ...extensions] })
  };
}

// packages/editor-runtime/src/lib/feature_flags.ts
var DESKTOP_FEATURE_FLAGS = Object.freeze({
  ELEF_ENABLE_REVISIONS: false,
  ELEF_ENABLE_LINEAGE: false
});
var featureName = (flag) => flag.replace(/^ELEF_ENABLE_/, "").toLowerCase();
function desktopFeatureEnabled(flag, flags = DESKTOP_FEATURE_FLAGS) {
  return flags[flag] === true;
}
function applyDesktopFeatureFlags(root = document, flags = DESKTOP_FEATURE_FLAGS) {
  const host = root.documentElement ?? root;
  for (const [flag, enabled] of Object.entries(flags)) {
    const name = featureName(flag);
    host.dataset[`elef${name.slice(0, 1).toUpperCase()}${name.slice(1)}Enabled`] = String(enabled === true);
  }
  for (const control of host.querySelectorAll("[data-desktop-feature]")) {
    const flag = `ELEF_ENABLE_${String(control.dataset.desktopFeature || "").toUpperCase()}`;
    const enabled = desktopFeatureEnabled(flag, flags);
    control.hidden = !enabled;
    control.setAttribute("aria-hidden", String(!enabled));
    if ("disabled" in control) control.disabled = !enabled;
  }
}

// packages/editor-runtime/src/lib/performance_measurement.ts
async function measurePaintedAction(action, {
  now = () => performance.now(),
  paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
} = {}) {
  const started = now();
  const result = await action();
  await paint();
  return { milliseconds: now() - started, result };
}
function percentile95(samples) {
  if (!Array.isArray(samples) || samples.length < 20 || samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Performance measurements require at least 20 finite, nonnegative samples.");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(samples.length * 0.95) - 1];
}

// packages/editor-runtime/src/lib/preview_request_body.ts
var PREVIEW_FIELDS = ["source", "title", "theme", "typography"];
function buildPreviewRequestBody(fields) {
  const body = new FormData();
  for (const field of fields) {
    if (!field?.name || field.disabled || !PREVIEW_FIELDS.some((name) => field.name?.endsWith(`[${name}]`) ?? false)) continue;
    body.set(field.name, field.value);
  }
  return body;
}

// packages/editor-runtime/src/lib/projection_editability.ts
function setProjectionBlockEditable(block, editable, ariaLabel) {
  setAttribute(block, "contenteditable", String(editable));
  if (editable) {
    setAttribute(block, "role", "textbox");
    setAttribute(block, "aria-label", ariaLabel);
    setAttribute(block, "aria-multiline", "true");
    setAttribute(block, "spellcheck", "true");
    removeAttribute(block, "aria-readonly");
  } else {
    removeAttribute(block, "role");
    removeAttribute(block, "aria-label");
    removeAttribute(block, "aria-multiline");
    removeAttribute(block, "spellcheck");
    setAttribute(block, "aria-readonly", "true");
  }
}
function setAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
function removeAttribute(element, name) {
  if (element.hasAttribute(name)) element.removeAttribute(name);
}

// packages/editor-runtime/src/lib/renderer_worker_client.ts
var RENDER_TIMEOUT_MS = 4e3;
function createRendererClient({
  WorkerClass = globalThis.Worker,
  timeoutMs = RENDER_TIMEOUT_MS,
  workerUrl = new URL("./renderer-worker.js", import.meta.url)
} = {}) {
  let worker = null;
  let nextId = 0;
  const pending = /* @__PURE__ */ new Map();
  const WARMUP_ID = 0;
  let warmupPromise = null;
  function failAll(error) {
    for (const request2 of pending.values()) {
      clearTimeout(request2.timer);
      request2.reject(error);
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  }
  function ensureWorker() {
    if (worker) return worker;
    if (typeof WorkerClass !== "function") throw Object.assign(new Error("Preview workers are unavailable."), { code: "unsupported", retryable: false });
    worker = new WorkerClass(workerUrl, { type: "module", name: "elef-markdown-renderer" });
    worker.addEventListener("message", ({ data }) => {
      const request2 = pending.get(data?.id);
      if (!request2) return;
      pending.delete(data.id);
      clearTimeout(request2.timer);
      if (data.error) {
        request2.reject(Object.assign(new Error(data.error.message), data.error));
      } else {
        request2.resolve(data.result);
      }
    });
    worker.addEventListener("error", () => failAll(Object.assign(new Error("The preview renderer stopped unexpectedly."), { code: "render_error", retryable: true })));
    return worker;
  }
  function request(input) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const request2 = pending.get(id);
        pending.delete(id);
        const error = Object.assign(new Error("Preview took too long and was stopped. Your source is safe."), { code: "render_timeout", retryable: true });
        request2?.reject(error);
        failAll(error);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        ensureWorker().postMessage({ id, input });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  const WARMUP_DECK = "# Warmup\n\nInline $x^2$ math.\n\n```js\nconst warm = 1\n```\n\n---\n\nSecond slide.\n";
  function warmup() {
    if (!warmupPromise) {
      warmupPromise = (async () => {
        try {
          const prewarmed = ensureWorker();
          prewarmed.postMessage({ id: WARMUP_ID, input: { source: WARMUP_DECK } });
          prewarmed.postMessage({ id: WARMUP_ID, input: { kind: "markdown-block", source: "Elef" } });
        } catch (_error) {
        }
      })();
    }
    return warmupPromise;
  }
  return {
    warmup() {
      return warmup();
    },
    render(input) {
      return request(input);
    },
    async renderMarkdownBlock(source) {
      const result = await request({ kind: "markdown-block", source });
      if (typeof result !== "string") {
        throw Object.assign(new Error(`Preview markdown-block reply was not text (got ${typeof result}).`), { code: "render_type", retryable: false });
      }
      return result;
    },
    terminate() {
      failAll(Object.assign(new Error("Preview renderer was closed."), { code: "render_cancelled", retryable: false }));
    },
    get pendingCount() {
      return pending.size;
    }
  };
}

// packages/editor-runtime/src/lib/request_identity.ts
function createRequestGuard() {
  let generation = 0;
  function request() {
    generation += 1;
    return generation;
  }
  function isCurrent(token) {
    return token === generation;
  }
  function invalidate() {
    generation += 1;
  }
  return Object.freeze({ request, isCurrent, invalidate });
}

// packages/editor-runtime/src/lib/vim_line_numbers.ts
function formatLineNumber(number, state, mode) {
  if (mode !== "relative") return String(number);
  const activeLine = state.doc.lineAt(state.selection.main.head).number;
  return String(Math.abs(activeLine - number));
}
export {
  DESKTOP_FEATURE_FLAGS,
  applyDesktopFeatureFlags,
  applyEditorSource,
  bindEditorAction,
  buildPreviewRequestBody,
  clientMountController,
  configureEditorKind,
  createCodeMirrorBinding,
  createDeckOpenFlow,
  createDocumentGraphCache,
  createDocumentState,
  createRendererClient,
  createRequestGuard,
  desktopFeatureEnabled,
  editorActionControl,
  editorFor,
  enableVisualModeAfterPreview,
  enableVisualModeFromInstalledPreview,
  formatLineNumber,
  installPreviewHtml,
  measurePaintedAction,
  mergeAuthoringRegistryEntries,
  mermaidAssetUrl,
  mountEditorHosts,
  percentile95,
  prepareDeckOpen,
  presentConflictDialog,
  renderEditorView,
  renderWorkerMessage,
  setProjectionBlockEditable,
  startClientMounts,
  translateClientMounts,
  translateElementMounts,
  waitForEditorController
};
