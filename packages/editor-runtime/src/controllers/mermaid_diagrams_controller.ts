import { Controller } from "@hotwired/stimulus"
import { renderMermaidDiagrams } from "./mermaid_runtime.js"

// Rendered work HTML replaces itself wholesale whenever the editor preview
// refreshes, so a connect alone is not enough: watch the subtree and pick up
// freshly inserted diagrams. `mermaid.run` skips containers it already drew, so
// repeated passes are cheap.
export default class extends Controller {
  connect() {
    this.renderFrame = null
    this.observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => this.scheduleRender())
    this.observer?.observe(this.element, { childList: true, subtree: true })
    this.scheduleRender()
  }

  disconnect() {
    this.observer?.disconnect()
    if (this.renderFrame) cancelAnimationFrame(this.renderFrame)
    this.renderFrame = null
  }

  scheduleRender() {
    if (this.renderFrame) return
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null
      this.render()
    })
  }

  render() {
    renderMermaidDiagrams(this.element).catch((error) => {
      console.error("Elef could not render Mermaid diagrams.", error)
    })
  }
}