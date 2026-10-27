import { Compartment, Prec, StateEffect } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { continuousTableGeometryChanged, createContinuousTables } from "./continuous_tables.js"
import { livePreviewField } from "@elef/client/editor"
import { sanitizePreview } from "@elef/client/sanitize"
import { continuousFlowGeometryChanged, createContinuousFlow } from "./continuous_flow.js"
import { registerContinuousVimMotions } from "./continuous_vim.js"

export interface ContinuousDocumentEditor {
  readonly view: EditorView
  readonly element: HTMLElement
  projectionController(): { flushPendingProjectionEdits?(): void } | null | undefined
}

export interface ContinuousDocumentHandle { dispose(): void }
const mounting = new WeakSet<EditorView>()

// A separate, explicitly mounted feasibility surface. It shares the existing
// EditorView, history and Vim instance; merely loading the normal source
// editor must not load or activate the candidate implementation.
export async function mountContinuousDocument(editor: ContinuousDocumentEditor): Promise<ContinuousDocumentHandle> {
  if (mounting.has(editor.view)) throw new Error("Continuous authoring is already mounted")
  mounting.add(editor.view)
  try { return await mountSurface(editor) }
  catch (error) { mounting.delete(editor.view); throw error }
}

async function mountSurface(editor: ContinuousDocumentEditor): Promise<ContinuousDocumentHandle> {
  const form = editor.element.closest("form")
  if (!form) throw new Error("Continuous authoring requires an editor form")
  if (form.dataset.editorSurface === "continuous") throw new Error("Continuous authoring is already mounted")
  const { renderPreviewCore } = await import("@elef/client/preview-core")
  registerContinuousVimMotions()
  if (!editor.element.isConnected) throw new Error("The editor was closed before continuous authoring loaded")
  editor.projectionController()?.flushPendingProjectionEdits?.()
  const compartment = new Compartment()
  const document = editor.element.ownerDocument
  const probe = document.createElement("div")
  probe.className = "continuous-table-measure document-surface"
  probe.style.maxWidth = `${editor.element.clientWidth}px`
  editor.element.append(probe)
  const projectionClasses = Array.from(form.querySelector(".editor-projection .document-reader")?.classList ?? [])
  const classValue = (prefix: string) => projectionClasses.find(value => value.startsWith(prefix))?.slice(prefix.length)
  let theme = form.dataset.continuousTheme || classValue("document-theme-") || form.dataset.continuousDefaultTheme || "match"
  let typography = form.dataset.continuousTypography || classValue("document-typography-") || form.dataset.continuousDefaultTypography || "book"
  const shell = editor.element.closest<HTMLElement>(".editor-shell")
  const addedFieldClasses = new Set<string>()
  const addedShellClasses = new Set<string>()
  const applyStyleClasses = () => {
    for (const name of addedFieldClasses) editor.element.classList.remove(name)
    for (const name of addedShellClasses) shell?.classList.remove(name)
    addedFieldClasses.clear()
    addedShellClasses.clear()
    const classes = ["document-reader", `document-theme-${theme}`, `work-theme-${theme}`,
      `document-typography-${typography}`, `work-typography-${typography}`]
    for (const name of classes) {
      if (!editor.element.classList.contains(name)) { editor.element.classList.add(name); addedFieldClasses.add(name) }
      if (name !== "document-reader" && shell && !shell.classList.contains(name)) { shell.classList.add(name); addedShellClasses.add(name) }
    }
  }
  applyStyleClasses()
  const cache = new Map<string, readonly number[]>()
  const selectors: Readonly<Record<string, string>> = { h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6",
    paragraph: "p", quote: "blockquote", list: "ul", code: "pre", table: "table" }
  const margins: Record<string, { before: number; after: number }> = {}
  const measureMargins = () => {
    sanitizePreview(probe, renderPreviewCore({ source: "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n\nParagraph.\n\n> Quotation\n\n- Item\n\n```\ncode\n```\n\n| A | B |\n| - | - |\n| x | y |", kind: "document" }).html, { interactive: false })
    for (const [kind, selector] of Object.entries(selectors)) {
      const element = probe.querySelector(selector)
      const style = element ? getComputedStyle(element) : null
      margins[kind] = { before: parseFloat(style?.marginTop ?? "0") || 0, after: parseFloat(style?.marginBottom ?? "0") || 0 }
    }
  }
  measureMargins()
  const measure = (markdown: string): readonly number[] => {
    const key = `${editor.element.clientWidth}:${markdown}`
    const cached = cache.get(key)
    if (cached) return cached
    sanitizePreview(probe, renderPreviewCore({ source: markdown, kind: "document", allowRemoteMedia: false }).html,
      { interactive: false })
    const table = probe.querySelector("table")
    const width = table?.getBoundingClientRect().width ?? 0
    if (!table || width <= 0) throw new Error("The renderer could not measure the table")
    const fractions = Array.from(table.querySelectorAll("thead th"), cell => cell.getBoundingClientRect().width / width)
    if (cache.size > 64) cache.clear()
    cache.set(key, fractions)
    return fractions
  }
  form.dataset.editorSurface = "continuous"
  const extensions = [createContinuousTables(measure), createContinuousFlow(margins),
    EditorView.contentAttributes.of(view => ({ class: view.state.field(livePreviewField).enabled ? "cm-lineWrapping" : "" })),
    Prec.highest(EditorView.theme({
      "&.continuous-document": { background: "var(--document-page-background)", color: "var(--document-page-ink)" },
      "&.continuous-document .cm-scroller": { fontFamily: "var(--oradia-sans)", fontSize: "var(--document-body-size)",
        lineHeight: "var(--document-body-leading)", overflow: "visible" },
      "&.continuous-document .cm-content": { padding: "0", caretColor: "currentColor" },
      "&.continuous-document .cm-line": { padding: "0" },
      "&.continuous-document .cm-continuous-gap": { height: "0", minHeight: "0", fontSize: "0", lineHeight: "0" },
      "&.continuous-document .cm-widgetBuffer": { height: "0", verticalAlign: "baseline" },
      "&.continuous-document .cm-gutters": { display: "none" },
      "&.continuous-document .cm-continuous-table-row": { display: "flex", alignItems: "stretch" },
      "&.continuous-document .cm-activeLine": { backgroundColor: "transparent" },
      "&.continuous-document .cm-live-heading": { margin: "0" },
      "&.continuous-document .cm-live-heading-text, &.continuous-document .cm-live-heading-text *": { fontWeight: "inherit", textDecoration: "none" },
    })),
    EditorView.editorAttributes.of(view => view.state.field(livePreviewField).enabled
      ? { "aria-label": "Visual document", class: "continuous-document document-surface" }
      : { "aria-label": "Markdown source", class: "" })]
  let configured = false
  let disposed = false
  let measuredWidth = editor.element.clientWidth
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    const width = editor.element.clientWidth
    if (disposed || width === measuredWidth || width <= 0) return
    measuredWidth = width
    probe.style.maxWidth = `${width}px`
    cache.clear()
    if (configured) editor.view.dispatch({ effects: continuousTableGeometryChanged.of() })
  })
  const appearanceChanged = () => {
    const selectedTheme = form.querySelector<HTMLSelectElement>('[data-appearance-target="theme"]')?.value
    const selectedTypography = form.querySelector<HTMLSelectElement>('[data-appearance-target="typography"]')?.value
    const nextTheme = selectedTheme || form.dataset.continuousDefaultTheme || theme
    const nextTypography = selectedTypography || form.dataset.continuousDefaultTypography || typography
    if (nextTheme === theme && nextTypography === typography) return
    theme = nextTheme
    typography = nextTypography
    applyStyleClasses()
    cache.clear()
    measureMargins()
    if (configured) editor.view.dispatch({ effects: [continuousFlowGeometryChanged.of(), continuousTableGeometryChanged.of()] })
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (configured && editor.view.dom.isConnected) editor.view.dispatch({ effects: compartment.reconfigure([]) })
    resize?.disconnect()
    form.removeEventListener("change", appearanceChanged)
    form.removeEventListener("elef:preview-updated", appearanceChanged)
    delete form.dataset.editorSurface
    probe.remove()
    editor.element.classList.remove(...addedFieldClasses)
    shell?.classList.remove(...addedShellClasses)
    mounting.delete(editor.view)
    editor.element.dispatchEvent(new CustomEvent("elef:editor-surface-change", { bubbles: true }))
  }
  try {
    editor.view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(extensions)) })
    configured = true
    form.addEventListener("change", appearanceChanged)
    form.addEventListener("elef:preview-updated", appearanceChanged)
    resize?.observe(editor.element)
    editor.element.dispatchEvent(new CustomEvent("elef:editor-surface-change", { bubbles: true }))
    editor.view.focus()
    return { dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
