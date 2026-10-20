// CodeMirror-backed editor binding for the client session (Phase 08).
//
// Host-owned implementation of the client editor-adapter interface
// (packages/client/src/session/editor_adapter.js): it binds a live
// CodeMirror controller behind { getText, setText, materializeEdits } so the
// session never touches the view. Behavior mirrors the previous inline
// policy closures exactly; only the construction site moved.
import type { EditorHandle } from "@elef/client/editor";
import { applyEditorSource } from "./editor_source.js"

export interface CodeMirrorBindingOptions {
  getEditor(): EditorHandle | null | undefined;
  getWorkId(): unknown;
  getFallbackValue(): string;
  setFallbackValue(source: string): void;
  waitForEditor(): Promise<EditorHandle | null>;
  materializeEdits?: () => void;
}

export function createCodeMirrorBinding({
  getEditor,
  getWorkId,
  getFallbackValue,
  setFallbackValue,
  waitForEditor,
  materializeEdits = () => {}
}: CodeMirrorBindingOptions) {
  function getText() {
    return getEditor()?.sourceValue ?? getFallbackValue()
  }

  function setText(source: string, { id = getWorkId(), expectedSource = getText() }: { id?: unknown; expectedSource?: string } = {}) {
    return applyEditorSource(source, {
      id,
      expectedSource,
      getWorkId,
      getSource: getText,
      waitForEditor,
      setFallback: setFallbackValue,
      materializeEdits
    })
  }

  return { getText, setText, materializeEdits }
}
