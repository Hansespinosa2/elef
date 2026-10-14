import { Controller } from "@hotwired/stimulus";
import { renderMermaidDiagrams } from "./mermaid_runtime.js";
class mermaid_diagrams_controller_default extends Controller {
  connect() {
    this.renderFrame = null;
    this.observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => this.scheduleRender());
    this.observer?.observe(this.element, { childList: true, subtree: true });
    this.scheduleRender();
  }
  disconnect() {
    this.observer?.disconnect();
    if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
    this.renderFrame = null;
  }
  scheduleRender() {
    if (this.renderFrame) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }
  render() {
    renderMermaidDiagrams(this.element).catch((error) => {
      console.error("Elef could not render Mermaid diagrams.", error);
    });
  }
}
export {
  mermaid_diagrams_controller_default as default
};
