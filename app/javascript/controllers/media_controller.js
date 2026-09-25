import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input", "fit", "status"]
  static values = { uploadUrl: String, enabled: Boolean }

  connect() {
    this.pendingRange = null
    this.targetSlideIndex = null
  }

  choose() {
    this.targetSlideIndex = null
    const editor = this.editor
    this.pendingRange = editor ? { from: editor.selectionStart, to: editor.selectionEnd } : null
    this.inputTarget.click()
  }

  chooseForSlide(event) {
    event.preventDefault()
    event.stopPropagation()
    const index = event.currentTarget.dataset.slideIndex
    this.targetSlideIndex = index !== undefined && index !== "" ? Number(index) : null
    this.pendingRange = null
    this.inputTarget.click()
  }

  async selected() {
    const file = this.inputTarget.files?.[0]
    this.inputTarget.value = ""
    if (!file) return

    const range = this.rangeForTargetSlide() || this.pendingRange
    this.targetSlideIndex = null
    this.pendingRange = null
    await this.upload(file, range)
  }

  paste(event) {
    const file = [...(event.clipboardData?.files || [])][0]
    if (!file) return
    event.preventDefault()

    const slideElement = document.activeElement?.closest?.("[data-slide-index], [data-editor-slide-id]") ||
      event.target?.closest?.("[data-slide-index], [data-editor-slide-id]")
    let targetIndex = null
    if (slideElement) {
      targetIndex = this.slideIndexFromElement(slideElement)
    }

    const editor = this.editor
    const range = targetIndex !== null
      ? this.rangeForSlide(targetIndex)
      : (editor ? { from: editor.selectionStart, to: editor.selectionEnd } : null)
    this.upload(file, range)
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

    const slideElement = event.target.closest?.("[data-slide-index], [data-editor-slide-id]")
    const targetIndex = slideElement ? this.slideIndexFromElement(slideElement) : null

    const editor = this.editor
    const range = targetIndex !== null
      ? this.rangeForSlide(targetIndex)
      : this.rangeAtSelectedSlideEnd(editor)

    await this.upload(event.dataTransfer.files[0], range)
  }

  slideIndexFromElement(element) {
    if (element.dataset.slideIndex !== undefined && element.dataset.slideIndex !== "") {
      return Number(element.dataset.slideIndex)
    }
    const match = element.dataset.editorSlideId?.match(/slide-(\d+)/)
    return match ? Number(match[1]) - 1 : null
  }

  async ensurePersisted() {
    if (this.enabledValue && this.uploadUrlValue) return true

    const form = this.element.closest("form") || this.element
    const titleInput = form.querySelector('input[name="presentation[title]"]')
    const title = titleInput?.value || "Untitled presentation"
    const source = this.editor?.value || form.querySelector('textarea[name="presentation[source]"]')?.value || ""
    const theme = form.querySelector('select[name="presentation[theme]"]')?.value || ""
    const typography = form.querySelector('select[name="presentation[typography]"]')?.value || ""

    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || ""
    const body = new FormData()
    body.append("presentation[title]", title)
    body.append("presentation[source]", source)
    body.append("presentation[theme]", theme)
    body.append("presentation[typography]", typography)

    const response = await fetch("/presentations", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken
      },
      body
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.errors?.join(", ") || "Failed to save new presentation before upload.")
    }

    const data = await response.json()
    this.enabledValue = true
    this.uploadUrlValue = data.upload_url
    if (form) {
      form.action = `/presentations/${data.id}`
      let methodInput = form.querySelector('input[name="_method"]')
      if (!methodInput) {
        methodInput = document.createElement("input")
        methodInput.type = "hidden"
        methodInput.name = "_method"
        methodInput.value = "patch"
        form.prepend(methodInput)
      }
      let lockInput = form.querySelector('input[name="presentation[lock_version]"]')
      if (!lockInput) {
        lockInput = document.createElement("input")
        lockInput.type = "hidden"
        lockInput.name = "presentation[lock_version]"
        form.prepend(lockInput)
      }
      lockInput.value = data.lock_version ?? 0

      let baseRevInput = form.querySelector('input[name="presentation[base_revision]"]')
      if (!baseRevInput) {
        baseRevInput = document.createElement("input")
        baseRevInput.type = "hidden"
        baseRevInput.name = "presentation[base_revision]"
        form.prepend(baseRevInput)
      }
      baseRevInput.value = data.revision_token || ""

      let sessionInput = form.querySelector('input[name="presentation[edit_session_id]"]')
      if (!sessionInput) {
        sessionInput = document.createElement("input")
        sessionInput.type = "hidden"
        sessionInput.name = "presentation[edit_session_id]"
        sessionInput.value = globalThis.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
        form.prepend(sessionInput)
      }

      const previewController = this.application.getControllerForElementAndIdentifier(this.element, "preview")
      if (previewController) {
        previewController.urlValue = `/presentations/${data.id}/preview`
      }
      const autosaveController = this.application.getControllerForElementAndIdentifier(this.element, "autosave")
      if (autosaveController) {
        autosaveController.workIdValue = data.id
        autosaveController.saveEnabledValue = true
        autosaveController.updateRevisionTokens(data)
      }
    }
    window.history.replaceState({}, "", data.edit_url)
    return true
  }

  async upload(file, range) {
    try {
      if (!this.enabledValue || !this.uploadUrlValue) {
        await this.ensurePersisted()
      }
      this.setStatus(`Uploading ${file.name}…`)
      const body = new FormData()
      body.append("file", file, file.name)
      body.append("fit", this.hasFitTarget ? this.fitTarget.value : "contain")

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

  rangeForTargetSlide() {
    return this.rangeForSlide(this.targetSlideIndex)
  }

  rangeForSlide(slideIndex) {
    if (slideIndex === null || slideIndex === undefined) return null
    const editor = this.editor
    if (!editor) return null
    const ranges = this.slideOverview?.sourceRanges(editor.value) || []
    const range = ranges[slideIndex]
    if (!range) return null

    const slideContent = editor.value.slice(range.start, range.end).trim()
    if (slideContent.length === 0) {
      return { from: range.start, to: range.end }
    }
    return { from: range.end, to: range.end }
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
