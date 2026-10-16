// Editor chrome for the shared renderer: interactive shells, toolbars, controls
// and Stimulus hooks wrapped around @elef/renderer projection output.
// Presentation chrome lives in @elef/client (features/presentation); this
// module keeps the document-editor chrome permanently (fork B, ADR-011). The bundle entry
// composes `editorChrome` with `renderPreviewCore` to keep shipped bytes
// identical. `renderPreviewCore` alone emits bare projection.
import {
  presentationBlockAttributes,
  presentationBlockControls,
  presentationEmptySlide,
  presentationRoot,
  presentationSlideBlock,
  presentationSlideFrame,
  presentationSlideToolbar,
} from "@elef/client/presentation-chrome"

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeAttribute(value: unknown): string {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}

export const editorChrome = {
  imageAttributes: () => ` data-editor-image-source="true" contenteditable="false"`,
  mathAttributes: ({ source, open, close }: { source: unknown; open: unknown; close: unknown }) => ` data-editor-math-source="${escapeAttribute(source)}" data-editor-math-open="${escapeAttribute(open)}" data-editor-math-close="${escapeAttribute(close)}" contenteditable="false"`,
  mediaFigure: ({ rendered, alt }: { rendered: unknown; alt: unknown }) => `<figure class="editor-media">${rendered}<figcaption class="editor-media-caption" aria-label="Editable image alt text" title="Edit image alt text">${escapeHtml(alt)}</figcaption></figure>`,
  documentBlockAttributes: ({ valid, mapped, region, positionClass }: { valid: unknown; mapped: any; region: unknown; positionClass: unknown }) => {
    const classes = ["document-editor-block", positionClass].filter(Boolean).join(" ")
    return valid
      ? `class="${classes}" data-editor-region-id="${mapped.editable_region_id}" data-editor-block-id="${mapped.id}" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input-&gt;visual-editor#projectionInput focus-&gt;visual-editor#blockFocus blur-&gt;visual-editor#blockBlur"`
      : `class="${classes}" contenteditable="false" aria-readonly="true"`
  },
  documentBlockShell: ({ attributes, rendered, positionControl }: { attributes: unknown; rendered: unknown; positionControl: unknown }) => `<div class="document-editor-block-shell"><div ${attributes}>${rendered}</div>${positionControl}</div>`,
  emptyDocumentBlock: ({ mapped }: { mapped: any }) => `<div class="document-editor-block-shell"><div class="document-editor-block" data-editor-region-id="${mapped.editable_region_id}" data-editor-block-id="${mapped.id}" data-editor-empty-block="true" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input-&gt;visual-editor#projectionInput focus-&gt;visual-editor#blockFocus blur-&gt;visual-editor#blockBlur"><p><br></p></div></div>`,
  positionControl: ({ block }: { block: any }) => {
    const horizontal = block.position?.horizontal || "left"
    const options = ["left", "center", "right"].map(value => `<option value="${value}"${value === horizontal ? " selected" : ""}>${value.slice(0, 1).toUpperCase()}${value.slice(1)}</option>`).join("")
    return `<label class="document-block-position-control" data-action="pointerdown-&gt;visual-editor#positionControlOpened">Align <select aria-label="Block alignment" data-visual-editor-block-id="${block.id}" data-action="focus-&gt;visual-editor#positionControlOpened keydown-&gt;visual-editor#positionControlKeydown change-&gt;visual-editor#alignmentChanged">${options}</select></label>`
  },
  documentRoot: ({ style, inner }: { style: any; inner: unknown }) => `<div class="document-reader document-theme-${style.theme} document-typography-${style.typography} work-theme-${style.theme} work-typography-${style.typography} document-editor-projection" data-controller="document-pages mermaid-diagrams"><div class="document-surface" data-document-pages-target="surface">${inner}</div></div>`,
  presentationBlockAttributes,
  presentationBlockControls,
  slideBlock: presentationSlideBlock,
  emptySlide: presentationEmptySlide,
  slideToolbar: presentationSlideToolbar,
  slideFrame: presentationSlideFrame,
  presentationRoot,
}
