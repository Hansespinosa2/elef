import { Controller } from "@hotwired/stimulus"

const IMAGE_TYPES_BY_EXTENSION = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp"
}

function filesFromTransfer(transfer) {
  const files = [...(transfer?.files || [])]
  for (const item of transfer?.items || []) {
    if (item.kind !== "file") continue
    const file = item.getAsFile?.()
    if (file && !files.includes(file)) files.push(file)
  }
  return files
}

function imageTypeForFilename(filename = "") {
  const extension = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
  return extension ? IMAGE_TYPES_BY_EXTENSION[extension] : null
}

export default class extends Controller {
  static targets = ["input", "fit", "status"]
  static values = { uploadUrl: String, enabled: Boolean, workKind: String }

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
    const files = filesFromTransfer(event.clipboardData)
    if (!files.length) return
    event.preventDefault()

    const editor = this.editor
    const sourcePaste = this.isSourceEditorTarget(event.target)
    const file = sourcePaste ? files.find((candidate) => this.isImageFile(candidate)) : files[0]
    if (!file) {
      this.setStatus("Choose an image file to insert into source mode.")
      return
    }

    if (sourcePaste) {
      const rangeId = editor.trackMediaRange({ from: editor.selectionStart, to: editor.selectionEnd })
      this.upload(file, null, { rangeId, imageOnly: true })
      return
    }

    const slideElement = document.activeElement?.closest?.("[data-slide-index], [data-editor-slide-id]") ||
      event.target?.closest?.("[data-slide-index], [data-editor-slide-id]")
    let targetIndex = null
    if (slideElement) {
      targetIndex = this.slideIndexFromElement(slideElement)
    }

    const range = targetIndex !== null
      ? this.rangeForSlide(targetIndex)
      : (editor ? { from: editor.selectionStart, to: editor.selectionEnd } : null)
    this.upload(file, range)
  }

  sourceDragOver(event) {
    if (this.editor?.editingMode !== "source") return
    const hasFiles = event.dataTransfer?.types?.includes("Files") || filesFromTransfer(event.dataTransfer).length > 0
    if (!hasFiles) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    event.currentTarget.classList.add("is-media-drop-target")
  }

  sourceDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return
    event.currentTarget.classList.remove("is-media-drop-target")
  }

  sourceDrop(event) {
    if (this.editor?.editingMode !== "source") return
    const files = filesFromTransfer(event.dataTransfer)
    if (!files.length) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.remove("is-media-drop-target")

    const file = files.find((candidate) => this.isImageFile(candidate))
    if (!file) {
      this.setStatus("Choose an image file to insert into source mode.")
      return
    }

    const editor = this.editor
    const position = editor.view.posAtCoords({ x: event.clientX, y: event.clientY })
    const fallback = editor.selectionEnd
    const range = { from: position ?? fallback, to: position ?? fallback }
    const rangeId = editor.trackMediaRange(range)
    this.upload(file, null, { rangeId, imageOnly: true })
  }

  isSourceEditorTarget(target) {
    return this.editor?.editingMode === "source" && Boolean(target?.closest?.(".editor-surface"))
  }

  isImageFile(file) {
    if (file.type?.startsWith("image/")) return true
    return ["", "application/octet-stream"].includes(file.type || "") && Boolean(imageTypeForFilename(file.name))
  }

  fileForSourceUpload(file) {
    const inferredType = imageTypeForFilename(file.name)
    const type = file.type?.startsWith("image/") ? file.type : inferredType || file.type
    const extension = Object.entries(IMAGE_TYPES_BY_EXTENSION).find(([, mimeType]) => mimeType === type)?.[0] || "png"
    const name = file.name || `pasted-image.${extension}`
    if (name === file.name && type === file.type) return file
    return new File([file], name, { type, lastModified: file.lastModified })
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
    const kind = this.hasWorkKindValue ? this.workKindValue : "presentation"
    const fallbackTitle = kind === "document" ? "Untitled document" : "Untitled presentation"
    const title = form.querySelector(`input[name="${kind}[title]"]`)?.value || fallbackTitle
    const source = this.editor?.value || form.querySelector(`textarea[name="${kind}[source]"]`)?.value || ""
    const theme = form.querySelector(`select[name="${kind}[theme]"]`)?.value || ""
    const typography = form.querySelector(`select[name="${kind}[typography]"]`)?.value || ""

    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || ""
    const body = new FormData()
    body.append(`${kind}[title]`, title)
    body.append(`${kind}[source]`, source)
    body.append(`${kind}[theme]`, theme)
    body.append(`${kind}[typography]`, typography)
    body.append("editor_mode", form.querySelector('[name="editor_mode"]')?.value || "visual")

    const response = await fetch(form.action, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken
      },
      body
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.errors?.join(", ") || `Failed to save new ${kind} before upload.`)
    }

    const data = await response.json()
    this.enabledValue = true
    this.uploadUrlValue = data.upload_url
    const workUrl = data.upload_url.replace(/\/assets\/?$/, "")
    if (form) {
      form.action = workUrl
      let methodInput = form.querySelector('input[name="_method"]')
      if (!methodInput) {
        methodInput = document.createElement("input")
        methodInput.type = "hidden"
        methodInput.name = "_method"
        methodInput.value = "patch"
        form.prepend(methodInput)
      }
      let lockInput = form.querySelector(`input[name="${kind}[lock_version]"]`)
      if (!lockInput) {
        lockInput = document.createElement("input")
        lockInput.type = "hidden"
        lockInput.name = `${kind}[lock_version]`
        form.prepend(lockInput)
      }
      lockInput.value = data.lock_version ?? 0

      let baseRevInput = form.querySelector(`input[name="${kind}[base_revision]"]`)
      if (!baseRevInput) {
        baseRevInput = document.createElement("input")
        baseRevInput.type = "hidden"
        baseRevInput.name = `${kind}[base_revision]`
        form.prepend(baseRevInput)
      }
      baseRevInput.value = data.revision_token || ""

      let sessionInput = form.querySelector(`input[name="${kind}[edit_session_id]"]`)
      if (!sessionInput) {
        sessionInput = document.createElement("input")
        sessionInput.type = "hidden"
        sessionInput.name = `${kind}[edit_session_id]`
        sessionInput.value = globalThis.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
        form.prepend(sessionInput)
      }

      const previewController = this.application.getControllerForElementAndIdentifier(this.element, "preview")
      if (previewController) {
        previewController.urlValue = `${workUrl}/preview`
      }
      const autosaveController = this.application.getControllerForElementAndIdentifier(this.element, "autosave")
      if (autosaveController) {
        autosaveController.workIdValue = data.id
        autosaveController.saveEnabledValue = true
        autosaveController.updateRevisionTokens(data)
      }
    }
    window.history.replaceState({}, "", data.edit_url || `${workUrl}/edit`)
    return true
  }

  async upload(file, range, { rangeId = null, imageOnly = false } = {}) {
    const fileName = file.name || "pasted-image"
    this.setStatus(`${this.enabledValue && this.uploadUrlValue ? "Uploading" : "Preparing"} ${fileName}…`, true)
    try {
      if (!this.enabledValue || !this.uploadUrlValue) {
        await this.ensurePersisted()
      }
      this.setStatus(`Uploading ${fileName}…`, true)
      const body = new FormData()
      const uploadFile = imageOnly ? this.fileForSourceUpload(file) : file
      body.append("file", uploadFile, uploadFile.name)
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
      const trackedRange = rangeId === null ? null : editor.consumeMediaRange(rangeId)
      if (rangeId !== null && !trackedRange) throw new Error("The source editor changed before the image finished uploading.")
      const insertionPoint = trackedRange || range || { from: editor.selectionStart, to: editor.selectionEnd }
      const markdown = this.withSpacing(editor.value, insertionPoint, result.source)
      editor.replaceRange(markdown, insertionPoint.from, insertionPoint.to)
      editor.focus()
      this.setStatus(`${fileName} added to the Markdown source.`)
    } catch (error) {
      this.setStatus(error.message || "Media could not be uploaded.")
    } finally {
      if (rangeId !== null) this.editor?.releaseMediaRange(rangeId)
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

  setStatus(message, busy = false) {
    if (!this.hasStatusTarget) return
    this.statusTarget.textContent = message
    this.statusTarget.setAttribute("aria-busy", String(busy))
  }

  get editor() {
    return this.element.querySelector("[data-controller~='editor']")?.editorController
  }

  get slideOverview() {
    return this.application.getControllerForElementAndIdentifier(this.element, "slide-overview")
  }
}
