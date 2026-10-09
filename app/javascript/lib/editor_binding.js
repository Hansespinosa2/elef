// CodeMirror-backed editor binding for the client session (Phase 08).
//
// Host-owned implementation of the client editor-adapter interface
// (packages/client/src/session/editor_adapter.js): it binds a live
// CodeMirror controller behind { getText, setText, materializeEdits } so the
// session never touches the view. Behavior mirrors the previous inline
// policy closures exactly; only the construction site moved.
import { applyEditorSource } from "./editor_source.js"

export function createCodeMirrorBinding({
  getEditor,
  getDeckId,
  getFallbackValue,
  setFallbackValue,
  waitForEditor,
  materializeEdits = () => {}
}) {
  function getText() {
    return getEditor()?.sourceValue ?? getFallbackValue()
  }

  function setText(source, { id = getDeckId(), expectedSource = getText() } = {}) {
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
