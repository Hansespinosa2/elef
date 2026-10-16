import { createActiveMathSpan, deRenderMath, finishMathBeforeEnter } from "../controllers/editor_math.js";
import { sourceOffsetForVisiblePosition } from "../controllers/editor_markdown.js";
import { asEditorSeam, editorFor } from "./editor_controller_lookup.js";
import {
  moveCaretBetweenBlocks,
  pointAtVisibleOffset,
  removeEmptyBlockSource,
  sourceOffsetForVisibleOffset,
  visibleOffsetAtPoint,
  visibleOffsetForSourceOffset
} from "../controllers/editor_caret.js";
import { markdownForVisibleText, renderInlineMath } from "../controllers/editor_markdown.js";
import { handleMathClick, handleMathKeydown, syncActiveMath } from "../controllers/editor_math.js";
import { setProjectionBlockEditable } from "./projection_editability.js";
import { mountPresentationEditor } from "@elef/client";
import { mountHostEditActions } from "./edit_actions_host.js";
function presentationEditorDeps() {
  return {
    moveCaretBetweenBlocks,
    pointAtVisibleOffset,
    removeEmptyBlockSource,
    sourceOffsetForVisibleOffset,
    visibleOffsetAtPoint,
    visibleOffsetForSourceOffset,
    markdownForVisibleText,
    renderInlineMath,
    handleMathClick,
    handleMathKeydown,
    syncActiveMath,
    setProjectionBlockEditable
  };
}
function documentEditorDeps() {
  return {
    ...presentationEditorDeps(),
    createActiveMathSpan,
    // The editor-math helper reports the de-rendered span (or null when
    // there was nothing to do); the client seam contracts that outcome as a
    // boolean. Null is the only falsy outcome, so this preserves the exact
    // runtime semantics the untyped JavaScript relied on.
    deRenderMath: (element, options) => deRenderMath(element, options) !== null,
    finishMathBeforeEnter,
    sourceOffsetForVisiblePosition
  };
}
function mountHostPresentationEditor(form) {
  const sourceField = () => form.querySelector(".source-field");
  const getEditor = () => asEditorSeam(editorFor(sourceField()));
  const mounted = mountPresentationEditor(form, {
    sourceElement: sourceField(),
    getEditor,
    deps: presentationEditorDeps()
  });
  const editActions = mountHostEditActions(form, getEditor, mounted.editor);
  return {
    editor: mounted.editor,
    destroy() {
      editActions?.dispose();
      mounted.destroy();
    }
  };
}
export {
  documentEditorDeps,
  mountHostPresentationEditor,
  presentationEditorDeps
};
