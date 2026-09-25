import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input", "fit", "status"]
  static values = { uploadUrl: String, enabled: Boolean }

  connect() {
    this.pendingRange = null
  }

  choose() {
    if (!this.enabledValue) return this.setStatus("Save this presentation once before attaching media.")
    const editor = this.editor
    this.pendingRange = editor ? { from: editor.selectionStart, to: editor.selectionEnd } : null
    this.inputTarget.click()
  }

  async selected() {
    const file = this.inputTarget.files?.[0]
    this.inputTarget.value = ""
    if (file) await this.upload(file, this.pendingRange)
  }

  paste(event) {
    const file = [...(event.clipboardData?.files || [])][0]
    if (!file) return
    event.preventDefault()
    const editor = this.editor
    this.upload(file, editor ? { from: editor.selectionStart, to: editor.selectionEnd } : null)
  }

  dragOver(event) {
    if (!event.dataTransfer?.types?.includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    event.currentTarget.classList.add("is-media-drop-target")
  }

  dragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return
    event.currentTarget.classList.remove("is-media-drop-target")
  }

  async drop(event) {
    if (!event.dataTransfer?.files?.length) return
    event.preventDefault()
    event.currentTarget.classList.remove("is-media-drop-target")
    if (!this.enabledValue) return this.setStatus("Save this presentation once before attaching media.")
    const editor = this.editor
    const range = this.rangeAtSelectedSlideEnd(editor)
    await this.upload(event.dataTransfer.files[0], range)
  }

  async upload(file, range) {
    if (!this.enabledValue || !this.uploadUrlValue) return this.setStatus("Save this presentation once before attaching media.")
    this.setStatus(`Uploading ${file.name}…`)
    const body = new FormData()
    body.append("file", file, file.name)
    body.append("fit", this.fitTarget.value)

    try {
      const response = await fetch(this.uploadUrlValue, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || ""
        },
        body
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Media could not be uploaded.")

      this.application.getControllerForElementAndIdentifier(this.element, "autosave")?.updateRevisionTokens(result)

      const editor = this.editor
      if (!editor) throw new Error("The Markdown editor is not ready yet.")
      const insertionPoint = range || { from: editor.selectionStart, to: editor.selectionEnd }
      const markdown = this.withSpacing(editor.value, insertionPoint, result.source)
      editor.replaceRange(markdown, insertionPoint.from, insertionPoint.to)
      editor.focus()
      this.setStatus(`${file.name} added to the Markdown source.`)
    } catch (error) {
      this.setStatus(error.message || "Media could not be uploaded.")
    }
  }

  withSpacing(source, range, markdown) {
    const before = source.slice(0, range.from)
    const after = source.slice(range.to)
    const prefix = before.length === 0 || /\n\n$/.test(before) ? "" : /\n$/.test(before) ? "\n" : "\n\n"
    const suffix = after.length === 0 || /^\n\n/.test(after) ? "" : /^\n/.test(after) ? "\n" : "\n\n"
    return `${prefix}${markdown}${suffix}`
  }

  rangeAtSelectedSlideEnd(editor) {
    if (!editor) return null
    const ranges = this.slideOverview?.sourceRanges(editor.value) || []
    const selected = Number(this.element.dataset.selectedSlideIndex || 0)
    const range = ranges[selected]
    return range ? { from: range.end, to: range.end } : { from: editor.selectionEnd, to: editor.selectionEnd }
  }

  setStatus(message) {
    if (this.hasStatusTarget) this.statusTarget.textContent = message
  }

  get editor() {
    return this.element.querySelector("[data-controller~='editor']")?.editorController
  }

  get slideOverview() {
    return this.application.getControllerForElementAndIdentifier(this.element, "slide-overview")
  }
}
