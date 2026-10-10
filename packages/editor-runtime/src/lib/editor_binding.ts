// CodeMirror-backed editor binding for the client session (Phase 08).
//
// Host-owned implementation of the client editor-adapter interface
// (packages/client/src/session/editor_adapter.js): it binds a live
// CodeMirror controller behind { getText, setText, materializeEdits } so the
// session never touches the view. Behavior mirrors the previous inline
// policy closures exactly; only the construction site moved.
import type { Controller } from "@hotwired/stimulus";
import { applyEditorSource } from "./editor_source.js"

export interface CodeMirrorBindingOptions {
  getEditor(): Controller | null | undefined;
  getDeckId(): unknown;
  getFallbackValue(): unknown;
  setFallbackValue(source: string): void;
  waitForEditor(): Promise<Controller | null>;
  materializeEdits?: () => void;
}

export function createCodeMirrorBinding({
  getEditor,
  getDeckId,
  getFallbackValue,
  setFallbackValue,
  waitForEditor,
  materializeEdits = () => {}
}: CodeMirrorBindingOptions) {
  function getText() {
    return getEditor()?.sourceValue ?? getFallbackValue()
  }

  function setText(source: string, { id = getDeckId(), expectedSource = getText() }: { id?: unknown; expectedSource?: string } = {}) {
    return applyEditorSource(source, {
      id,
      expectedSource,
      getDeckId,
      getSource: getText,
      waitForEditor,
      setFallback: setFallbackValue,
      materializeEdits
    })
  }

  return { getText, setText, materializeEdits }
}
