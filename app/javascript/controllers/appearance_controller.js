import { Controller } from "@hotwired/stimulus"

const normalizeSource = (source) => String(source ?? "").replace(/\r\n?/g, "\n")

export default class extends Controller {
  static targets = ["themeField", "theme", "typographyField", "typography", "hint"]

  connect() {
    this.form = this.element.closest("form")
    this.mode = this.form?.dataset.editorMode === "source" ? "source" : "visual"
    this.styledSource = this.currentSource()
    this.sourceStyleStale = false
    this.style = {
      theme: this.themeTarget.value,
      typography: this.typographyTarget.value
    }
    this.modeChanged = (event) => {
      const nextMode = event.detail?.mode === "source" ? "source" : "visual"
      if (nextMode === "source" && normalizeSource(this.currentSource()) !== normalizeSource(this.styledSource)) {
        this.sourceStyleStale = true
      }
      this.mode = nextMode
      this.sync()
    }
    this.sourceChanged = (event) => {
      if (!event.target?.matches?.('[name$="[source]"]')) return
      if (this.mode === "source") this.sourceStyleStale = true
      this.sync()
    }
    this.appearanceChanged = (event) => {
      if (event.target === this.themeTarget) this.style.theme = this.themeTarget.value
      if (event.target === this.typographyTarget) this.style.typography = this.typographyTarget.value
    }
    this.previewUpdated = (event) => {
      const style = event.detail?.payload?.style
      if (!style) return

      this.style = style
      this.styledSource = typeof event.detail.source === "string" ? event.detail.source : this.currentSource()
      this.sourceStyleStale = false
      this.sync()
    }
    this.form?.addEventListener("elef:editor-mode-change", this.modeChanged)
    this.form?.addEventListener("input", this.sourceChanged)
    this.form?.addEventListener("change", this.appearanceChanged)
    this.form?.addEventListener("elef:preview-updated", this.previewUpdated)
    this.sync()
  }

  disconnect() {
    this.form?.removeEventListener("elef:editor-mode-change", this.modeChanged)
    this.form?.removeEventListener("input", this.sourceChanged)
    this.form?.removeEventListener("change", this.appearanceChanged)
    this.form?.removeEventListener("elef:preview-updated", this.previewUpdated)
  }

  sync() {
    const visual = this.mode === "visual"
    this.themeFieldTarget.hidden = !visual
    this.typographyFieldTarget.hidden = !visual
    if (this.hasHintTarget) {
      this.hintTarget.textContent = visual
        ? "Appearance overrides stay in the Markdown front matter."
        : "Source mode keeps appearance in the Markdown front matter. Reveal source metadata to edit it."
    }

    const editable = visual && !this.sourceStyleStale
    this.themeTarget.disabled = !editable
    this.typographyTarget.disabled = !editable
    if (this.style && !this.sourceStyleStale) {
      this.themeTarget.value = this.style.theme || ""
      this.typographyTarget.value = this.style.typography || ""
    }
  }

  currentSource() {
    return this.form?.querySelector('[name$="[source]"]')?.value || ""
  }
}
