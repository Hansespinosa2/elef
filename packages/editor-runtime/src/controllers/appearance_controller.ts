import { Controller } from "@hotwired/stimulus"
import { withAppearanceValue } from "@elef/work-model"

const normalizeSource = (source: unknown): string => String(source ?? "").replace(/\r\n?/g, "\n")

export default class extends Controller {
  static targets = ["panelContainer", "themeField", "theme", "typographyField", "typography", "hint"]

  connect() {
    this.form = this.element.closest("form")
    this.mode = this.form?.dataset.editorMode === "source" ? "source" : "visual"
    this.styledSource = this.currentSource()
    this.sourceStyleStale = false
    this.style = {
      theme: this.themeTarget.value,
      typography: this.typographyTarget.value
    }
    this.modeChanged = (event: any) => {
      const nextMode = event.detail?.mode === "source" ? "source" : "visual"
      if (nextMode === "source" && normalizeSource(this.currentSource()) !== normalizeSource(this.styledSource)) {
        this.sourceStyleStale = true
      }
      this.mode = nextMode
      this.sync()
    }
    this.sourceChanged = (event: any) => {
      if (!event.target?.matches?.('[name$="[source]"]')) return
      if (this.mode === "source") this.sourceStyleStale = true
      this.sync()
    }
    this.appearanceChanged = (event: any) => {
      const key = event.target === this.themeTarget ? "theme"
        : event.target === this.typographyTarget ? "typography"
          : null
      if (!key) return

      let source = this.currentSource()
      try {
        source = withAppearanceValue(source, "theme", this.themeTarget.value)
        source = withAppearanceValue(source, "typography", this.typographyTarget.value)
      } catch (_error) {
        this.sync()
        return
      }

      this.style[key] = event.target.value
      if (this.mode !== "visual" || this.sourceStyleStale || source === this.currentSource()) return

      const sourceField = this.form.querySelector('[name$="[source]"]')
      const editor = this.form.querySelector(".source-field")?.editorController
      if (editor?.setExternalValue) {
        editor.setExternalValue(source)
      } else if (sourceField) {
        sourceField.value = source
        sourceField.dispatchEvent(new Event("input", { bubbles: true }))
      }
    }
    this.previewUpdated = (event: any) => {
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
    if (this.hasPanelContainerTarget) {
      this.panelContainerTarget.hidden = !visual
      if (!visual) this.panelContainerTarget.open = false
    }
    if (this.hasThemeFieldTarget) {
      this.themeFieldTarget.hidden = !visual
    }
    if (this.hasTypographyFieldTarget) {
      this.typographyFieldTarget.hidden = !visual
    }
    if (this.hasHintTarget) {
      this.hintTarget.hidden = !visual
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
