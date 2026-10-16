import { Controller } from "@hotwired/stimulus";
import { DocumentEditor } from "@elef/client";
import { asEditorSeam, editorFor } from "../lib/editor_controller_lookup.js";
import { enableVisualModeAfterPreview, enableVisualModeFromInstalledPreview } from "../lib/editor_view.js";
import { documentEditorDeps } from "../lib/presentation_editor_host.js";
class visual_editor_controller_default extends Controller {
  static targets = ["projection"];
  static values = { kind: String, focusTitle: Boolean };
  connect() {
    this.editor = new DocumentEditor({
      element: this.element,
      projection: this.hasProjectionTarget ? this.projectionTarget : null,
      kind: this.kindValue,
      focusTitle: this.focusTitleValue,
      lookupEditor: (element) => asEditorSeam(editorFor(element)),
      afterPreview: (element, detail) => enableVisualModeAfterPreview(element, detail),
      restorePreviewToggle: (element) => enableVisualModeFromInstalledPreview(element),
      deps: documentEditorDeps()
    });
    this.element.visualEditorController = this;
    this.editor.connect();
  }
  disconnect() {
    this.editor?.disconnect();
    if (this.element.visualEditorController === this) delete this.element.visualEditorController;
  }
  // Desktop switches work kinds without remounting the form; push the host
  // value into the live feature so document key handling follows the work.
  kindValueChanged() {
    this.editor?.setKind?.(this.kindValue);
  }
  blockFocus(event) {
    this.editor.blockFocus(event);
  }
  blockBlur(event) {
    this.editor.blockBlur(event);
  }
  projectionInput(event) {
    this.editor.projectionInput(event);
  }
  projectionKeydown(event) {
    this.editor.projectionKeydown(event);
  }
  alignmentChanged(event) {
    this.editor.alignmentChanged(event);
  }
  positionControlOpened(event) {
    this.editor.positionControlOpened(event);
  }
  positionControlKeydown(event) {
    this.editor.positionControlKeydown(event);
  }
  // Host-owned editor surface: flush, caret capture/restore through the
  // shared feature; the implementation lives in the client.
  flushPendingProjectionEdits() {
    this.editor.flushPendingProjectionEdits();
  }
  captureCaret() {
    return this.editor.captureCaret();
  }
  restoreCaret(sourceOffset, preferredBlockId) {
    return this.editor.restoreCaret(sourceOffset, preferredBlockId);
  }
  applyVisualAssistInsert(edit) {
    return this.editor.applyVisualAssistInsert(edit);
  }
}
export {
  visual_editor_controller_default as default
};
