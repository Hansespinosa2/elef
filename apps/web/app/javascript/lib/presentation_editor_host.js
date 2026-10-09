import { createActiveMathSpan, deRenderMath, finishMathBeforeEnter } from "controllers/editor_math"
import { sourceOffsetForVisiblePosition } from "controllers/editor_markdown"
import { editorFor } from "lib/editor_controller_lookup"
import {
  moveCaretBetweenBlocks,
  pointAtVisibleOffset,
  removeEmptyBlockSource,
  sourceOffsetForVisibleOffset,
  visibleOffsetAtPoint,
  visibleOffsetForSourceOffset
} from "controllers/editor_caret"
import { markdownForVisibleText, renderInlineMath } from "controllers/editor_markdown"
import { handleMathClick, handleMathKeydown, syncActiveMath } from "controllers/editor_math"
import { setProjectionBlockEditable } from "lib/projection_editability"
import { mountPresentationEditor } from "@elef/client"

// Shared host seam for the client presentation editor. Both hosts (Rails
// editor forms via the presentation host adapter, desktop via
// file_library_application) mount through here so the editing utilities stay
// wired identically. The utilities themselves stay host-owned until
// Phase 09; the client module only orchestrates through this deps object.
export function presentationEditorDeps() {
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
  }
}

export function documentEditorDeps() {
  return {
    ...presentationEditorDeps(),
    createActiveMathSpan,
    deRenderMath,
    finishMathBeforeEnter,
    sourceOffsetForVisiblePosition
  }
}

export function mountHostPresentationEditor(form) {
  // configureEditorKind marks the source field as the editor source target;
  // the CodeMirror editor host publishes itself there too.
  const sourceField = () => form.querySelector(".source-field")
  return mountPresentationEditor(form, {
    sourceElement: sourceField(),
    getEditor: () => editorFor(sourceField()),
    deps: presentationEditorDeps()
  })
}
