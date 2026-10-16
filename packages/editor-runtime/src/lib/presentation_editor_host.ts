import { createActiveMathSpan, deRenderMath, finishMathBeforeEnter } from "../controllers/editor_math.js"
import { sourceOffsetForVisiblePosition } from "../controllers/editor_markdown.js"
import { asEditorSeam, editorFor } from "./editor_controller_lookup.js"
import {
  moveCaretBetweenBlocks,
  pointAtVisibleOffset,
  removeEmptyBlockSource,
  sourceOffsetForVisibleOffset,
  visibleOffsetAtPoint,
  visibleOffsetForSourceOffset
} from "../controllers/editor_caret.js"
import { markdownForVisibleText, renderInlineMath } from "../controllers/editor_markdown.js"
import { handleMathClick, handleMathKeydown, syncActiveMath } from "../controllers/editor_math.js"
import { setProjectionBlockEditable } from "./projection_editability.js"
import { mountPresentationEditor } from "@elef/client"
import type { DocumentEditorDeps, PresentationEditorDeps, PresentationEditorHost } from "@elef/client"

// Shared host seam for the client presentation editor. Both hosts (Rails
// editor forms via the presentation host adapter, desktop via
// file_library_application) mount through here so the editing utilities stay
// wired identically. The utilities themselves stay host-owned until
// Phase 09; the client module only orchestrates through this deps object.
export function presentationEditorDeps(): PresentationEditorDeps {
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

export function documentEditorDeps(): DocumentEditorDeps {
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
  }
}

export function mountHostPresentationEditor(form: PresentationEditorHost) {
  // configureEditorKind marks the source field as the editor source target;
  // the CodeMirror editor host publishes itself there too.
  const sourceField = () => form.querySelector(".source-field")
  return mountPresentationEditor(form, {
    sourceElement: sourceField(),
    getEditor: () => asEditorSeam(editorFor(sourceField())),
    deps: presentationEditorDeps()
  })
}
