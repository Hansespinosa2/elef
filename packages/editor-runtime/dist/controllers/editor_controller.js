import { Controller } from "@hotwired/stimulus";
import { mountEditor } from "@elef/client/editor";
class editor_controller_default extends Controller {
  editor;
  connect() {
    this.editor = mountEditor({ element: this.element });
  }
  disconnect() {
    this.editor?.dispose();
    this.editor = void 0;
  }
  showVisual(event) {
    this.editor?.showVisual(event);
  }
  showSource(event) {
    this.editor?.showSource(event);
  }
  toggleMetadataVisibility() {
    this.editor?.toggleMetadataVisibility();
  }
  toggleVim(event) {
    this.editor?.toggleVim(event);
  }
  captureEscapeKey(event) {
    this.editor?.captureEscapeKey(event);
  }
  clearEscapeKey() {
    this.editor?.clearEscapeKey();
  }
  lineNumbersChanged(event) {
    this.editor?.lineNumbersChanged(event);
  }
  modeAwareCursorChanged(event) {
    this.editor?.modeAwareCursorChanged(event);
  }
  sync() {
    this.editor?.sync();
  }
}
export {
  editor_controller_default as default
};
