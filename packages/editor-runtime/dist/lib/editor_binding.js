import { applyEditorSource } from "./editor_source.js";
function createCodeMirrorBinding({
  getEditor,
  getWorkId,
  getFallbackValue,
  setFallbackValue,
  waitForEditor,
  materializeEdits = () => {
  }
}) {
  function getText() {
    return getEditor()?.sourceValue ?? getFallbackValue();
  }
  function setText(source, { id = getWorkId(), expectedSource = getText() } = {}) {
    return applyEditorSource(source, {
      id,
      expectedSource,
      getWorkId,
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
