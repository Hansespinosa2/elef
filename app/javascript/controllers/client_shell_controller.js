import { Controller } from "@hotwired/stimulus"
import { mountElef } from "@elef/client"
import { createRailsHost } from "host/rails-http-host"

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
  static values = { initialUrl: String, cardNotes: Object }

  async connect() {
    const host = await createRailsHost({ baseUrl: "", csrfToken: csrfToken() })
    this.shell = await mountElef(this.element, host, {
      initialUrl: this.initialUrlValue,
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
    })
  }

  disconnect() {
    this.shell?.unmount()
    this.shell = null
  }

  resolveWorkUrl(work) {
    return `/${workSegment(work)}/${work.id}/edit`
  }
}
