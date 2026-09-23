import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["preview"]

  connect() {
    this.active = true
    this.editor = null
    this.frame = null
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(this.previewTarget, { childList: true, subtree: true })
    this.handleEditorReady = (event) => {
      this.editor = event.detail?.editor || this.editor
      this.schedule()
    }
    this.sourceField = this.element.querySelector(".source-field")
    this.sourceField?.addEventListener("elef:editor-ready", this.handleEditorReady)
    this.sourceField?.addEventListener("input", this.handleInput = () => this.schedule())
    this.sourceField?.addEventListener("keyup", this.handleKeyup = () => this.schedule())
    this.editor ||= this.sourceField?.editorController
  }

  disconnect() {
    this.active = false
    cancelAnimationFrame(this.frame)
    this.observer?.disconnect()
    this.sourceField?.removeEventListener("elef:editor-ready", this.handleEditorReady)
    this.sourceField?.removeEventListener("input", this.handleInput)
    this.sourceField?.removeEventListener("keyup", this.handleKeyup)
  }

  schedule() {
    if (!this.active) return
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.followSource())
  }

  followSource() {
    const editor = this.editor || this.sourceField?.editorController
    if (!editor) return
    const line = editor.value.slice(0, editor.selectionStart).split("\n").length
    const anchors = [...this.previewTarget.querySelectorAll("[data-source-line]")]
    if (anchors.length === 0) return

    const anchor = anchors.reduce((current, candidate) => {
      const currentLine = Number(current.dataset.sourceLine) || 0
      const candidateLine = Number(candidate.dataset.sourceLine) || 0
      if (candidateLine <= line && candidateLine >= currentLine) return candidate
      return current
    }, anchors[0])
    const scroller = this.previewTarget
    const top = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top +
      scroller.scrollTop - Math.max(0, scroller.clientHeight - anchor.offsetHeight) / 2
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
    anchors.forEach((item) => item.classList.toggle("is-source-active", item === anchor))
  }
}
