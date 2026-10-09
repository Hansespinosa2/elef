import { Controller } from "@hotwired/stimulus"
import "elef-renderer"
import { GraphController, mountElef, renderGraphView } from "@elef/client"
import { createRailsHost } from "host/rails-http-host"
import { createRailsAuthoringSettingsTransport } from "host/rails-authoring-settings-transport"

// Mounts the shared Elef client on the Rails library routes with the Rails
// HTTP host adapter. Stimulus connect/disconnect gives the Turbo navigation
// lifecycle: mount on visit, unmount on leave. All web-only library extras
// (fork, present, load-samples are server templates; fork/publish actions,
// card notes, flash-equivalent notices) ride the documented mount options.
const LIBRARY_URLS = { all: "/", documents: "/documents", presentations: "/presentations" }

function workSegment(work) {
  return work.kind === "presentation" ? "presentations" : "documents"
}

function kindLabel(work) {
  return work.kind === "presentation" ? "Presentation" : "Document"
}

function csrfToken() {
  return document.querySelector("meta[name='csrf-token']")?.content ?? null
}

function submitPostForm(url, fields = {}) {
  const form = document.createElement("form")
  form.method = "post"
  form.action = url
  const tokenField = document.createElement("input")
  tokenField.type = "hidden"
  tokenField.name = "authenticity_token"
  tokenField.value = csrfToken() ?? ""
  form.appendChild(tokenField)
  for (const [name, value] of Object.entries(fields)) {
    const field = document.createElement("input")
    field.type = "hidden"
    field.name = name
    field.value = value
    form.appendChild(field)
  }
  document.body.appendChild(form)
  form.submit()
}

export default class extends Controller {
  static values = { initialUrl: String, cardNotes: Object, snippetsUrl: String, mathShortcutsUrl: String, closeUrl: String }

  async connect() {
    const host = await createRailsHost({ baseUrl: "", csrfToken: csrfToken() })
    // The settings routes (/settings, /snippets/*, /math_shortcuts/*) carry
    // registry endpoints plus a close target; every other shell page leaves
    // them empty and mounts without the authoring seam.
    const authoringSeam = this.snippetsUrlValue && this.mathShortcutsUrlValue
      ? {
          transport: createRailsAuthoringSettingsTransport({
            snippetsUrl: this.snippetsUrlValue,
            mathShortcutsUrl: this.mathShortcutsUrlValue
          }),
          renderExample: source => globalThis.ElefRenderer.renderMarkdownBlock(source),
          reloadEditorRegistry: async () => {},
          onClose: () => {
            if (!this.closeUrlValue) return
            if (window.Turbo) window.Turbo.visit(this.closeUrlValue)
            else window.location.assign(this.closeUrlValue)
          }
        }
      : undefined
    this.shell = await mountElef(this.element, host, {
      initialUrl: this.initialUrlValue,
      ...(authoringSeam === undefined ? {} : { authoring: authoringSeam }),
      navigate: target => {
        if (target.url !== undefined) {
          window.history.pushState({}, "", target.url)
        } else {
          const url = this.resolveWorkUrl({ id: target.workId, kind: target.kind })
          if (window.Turbo) window.Turbo.visit(url)
          else window.location.assign(url)
        }
      },
      resolveWorkUrl: work => `/${workSegment(work)}/${work.id}/edit`,
      resolveLibraryUrl: filter => LIBRARY_URLS[filter] ?? "/",
      resolvePreviewUrl: work => `/${workSegment(work)}/${work.id}`,
      resolveMediaBaseUrl: work => `/${workSegment(work)}/${work.id}/assets`,
      confirmDelete: work => window.confirm(`Delete ${work.title}?`),
      presentWork: work => submitPostForm(`/${workSegment(work)}/${work.id}/publish`),
      cardNote: work => this.cardNotesValue[work.id] ?? null,
      extraCardActions: work => {
        if (work.kind !== "presentation") return []
        const fork = forkType => submitPostForm(`/presentations/${work.id}/fork`, { fork_type: forkType })
        return [
          {
            label: "Fork",
            menuClass: "library-card-submenu fork-menu",
            children: [
              { label: "As continuation", run: () => fork("continuation") },
              { label: "As inspiration", run: () => fork("inspiration") },
            ],
          },
        ]
      },
      operationNotice: (operation, work) => `${kindLabel(work)} ${operation}.`,
      onLibraryEvent: event => {
        // Deleting a parent orphans its forks: merge the recomputed card
        // notes the API answered so the surviving cards read fresh. The
        // notice re-render that follows picks the merged notes up.
        const notes = event.type === "deleted" ? event.detail?.card_notes : null
        if (notes !== null && typeof notes === "object") {
          this.cardNotesValue = { ...this.cardNotesValue, ...notes }
        }
      },
    })
    this.mountGraph()
  }

  disconnect() {
    this.graph?.destroy()
    this.graph = null
    this.shell?.unmount()
    this.shell = null
  }

  // The document graph renders through the shared client module from the
  // server-computed graph payload. No onOpenDeck hook: node anchors keep
  // their server URLs and navigate natively (Turbo intercepts them),
  // exactly like the retired Stimulus controller's links.
  mountGraph() {
    this.graph?.destroy()
    this.graph = null
    const slot = this.element.querySelector("#document-graph-view")
    const holder = slot?.querySelector("[data-graph-data]") ?? this.element.querySelector("[data-graph-data]")
    if (!slot || !holder) return
    let graph = null
    try {
      graph = JSON.parse(holder.getAttribute("data-graph-data") || "null")
    } catch {
      graph = null
    }
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return
    renderGraphView(slot, graph)
    slot.hidden = false
    this.graph = new GraphController(slot, graph)
  }

  resolveWorkUrl(work) {
    return `/${workSegment(work)}/${work.id}/edit`
  }
}
