import { applyEditorSource } from "./editor_source.js";
function createCodeMirrorBinding({
  getEditor,
  getDeckId,
  getFallbackValue,
  setFallbackValue,
  waitForEditor,
  materializeEdits = () => {
  }
}) {
  function getText() {
    return getEditor()?.sourceValue ?? getFallbackValue();
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
    });
  }
  return { getText, setText, materializeEdits };
}
export {
  createCodeMirrorBinding
};
