// Editor chrome for the shared renderer: interactive shells, toolbars, controls
// and Stimulus hooks wrapped around @elef/renderer projection output.
// Current home is app/javascript/lib; a later client/ui package owns this.
// The bundle entry composes `editorChrome` with `renderPreviewCore` to keep
// shipped bytes identical. `renderPreviewCore` alone emits bare projection.
function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}

export const editorChrome = {
  imageAttributes: () => ` data-editor-image-source="true" contenteditable="false"`,
  mathAttributes: ({ source, open, close }) => ` data-editor-math-source="${escapeAttribute(source)}" data-editor-math-open="${escapeAttribute(open)}" data-editor-math-close="${escapeAttribute(close)}" contenteditable="false"`,
  mediaFigure: ({ rendered, alt }) => `<figure class="editor-media">${rendered}<figcaption class="editor-media-caption" aria-label="Editable image alt text" title="Edit image alt text">${escapeHtml(alt)}</figcaption></figure>`,
  documentBlockAttributes: ({ valid, mapped, region, positionClass }) => {
    const classes = ["document-editor-block", positionClass].filter(Boolean).join(" ")
    return valid
      ? `class="${classes}" data-editor-region-id="${mapped.editable_region_id}" data-editor-block-id="${mapped.id}" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input-&gt;visual-editor#projectionInput focus-&gt;visual-editor#blockFocus blur-&gt;visual-editor#blockBlur"`
      : `class="${classes}" contenteditable="false" aria-readonly="true"`
  },
  documentBlockShell: ({ attributes, rendered, positionControl }) => `<div class="document-editor-block-shell"><div ${attributes}>${rendered}</div>${positionControl}</div>`,
  emptyDocumentBlock: ({ mapped }) => `<div class="document-editor-block-shell"><div class="document-editor-block" data-editor-region-id="${mapped.editable_region_id}" data-editor-block-id="${mapped.id}" data-editor-empty-block="true" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input-&gt;visual-editor#projectionInput focus-&gt;visual-editor#blockFocus blur-&gt;visual-editor#blockBlur"><p><br></p></div></div>`,
  positionControl: ({ block }) => {
    const horizontal = block.position?.horizontal || "left"
    const options = ["left", "center", "right"].map(value => `<option value="${value}"${value === horizontal ? " selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")
    return `<label class="document-block-position-control" data-action="pointerdown-&gt;visual-editor#positionControlOpened">Align <select aria-label="Block alignment" data-visual-editor-block-id="${block.id}" data-action="focus-&gt;visual-editor#positionControlOpened keydown-&gt;visual-editor#positionControlKeydown change-&gt;visual-editor#alignmentChanged">${options}</select></label>`
  },
  documentRoot: ({ style, inner }) => `<div class="document-reader document-theme-${style.theme} document-typography-${style.typography} work-theme-${style.theme} work-typography-${style.typography} document-editor-projection" data-controller="document-pages mermaid-diagrams"><div class="document-surface" data-document-pages-target="surface">${inner}</div></div>`,
  presentationBlockAttributes: ({ valid, mapped, region, label }) => valid
    ? `data-editor-block-id="${mapped.id}" data-editor-region-id="${region.id}" data-editor-source-editable="${region.editable}"${region.editable ? ` contenteditable="true" role="textbox" aria-label="${label}" aria-multiline="true" spellcheck="true" data-action="input-&gt;presentation-editor#blockInput focus-&gt;presentation-editor#blockFocus blur-&gt;presentation-editor#blockBlur"` : " contenteditable=\"false\" aria-readonly=\"true\""}`
    : "contenteditable=\"false\" aria-readonly=\"true\"",
  presentationBlockControls: ({ slideIndex, blockIndex, blockCount, position }) => {
    const alignment = position ? (position.vertical === "top" ? position.horizontal : `${position.vertical === "middle" ? "center" : position.vertical} ${position.horizontal}`) : "left"
    const options = ["top", "middle", "bottom"].flatMap(vertical => ["left", "center", "right"].map(horizontal => {
      const value = vertical === "top" ? horizontal : `${vertical === "middle" ? "center" : vertical} ${horizontal}`
      return `<option value="${value}"${value === alignment ? " selected" : ""}>${value.split(" ").map(part => part[0].toUpperCase() + part.slice(1)).join(" ")}</option>`
    })).join("")
    return `<div class="presentation-editor-block-controls" aria-label="Block controls"><button type="button" data-presentation-editor-action="add-block-after" data-slide-index="${slideIndex}" data-block-index="${blockIndex}">Add block</button><button type="button" data-presentation-editor-action="delete-block" data-slide-index="${slideIndex}" data-block-index="${blockIndex}"${blockCount === 1 ? " disabled" : ""}>Delete</button><button type="button" aria-label="Move block up" data-presentation-editor-action="move-block-up" data-slide-index="${slideIndex}" data-block-index="${blockIndex}"${blockIndex === 0 ? " disabled" : ""}>↑</button><button type="button" aria-label="Move block down" data-presentation-editor-action="move-block-down" data-slide-index="${slideIndex}" data-block-index="${blockIndex}"${blockIndex === blockCount - 1 ? " disabled" : ""}>↓</button><label>Align <select aria-label="Block alignment" data-presentation-editor-align data-slide-index="${slideIndex}" data-block-index="${blockIndex}" data-action="change-&gt;presentation-editor#alignmentChanged">${options}</select></label></div>`
  },
  slideBlock: ({ className, attributes, content, controls }) => `<div class="${className}" ${attributes}>${content}</div>${controls}`,
  emptySlide: ({ index }) => `<div class="empty-slide"><p>Empty slide</p><button type="button" class="button secondary empty-slide-add-image" data-action="click-&gt;media#chooseForSlide" data-slide-index="${index}">Add image</button></div>`,
  slideToolbar: ({ index, slideCount }) => `<div class="presentation-editor-slide-toolbar" aria-label="Slide ${index + 1} controls"><span class="presentation-editor-slide-label">Slide ${index + 1}</span><button type="button" data-presentation-editor-action="add-slide-after" data-slide-index="${index}">Add slide</button><button type="button" class="presentation-editor-add-image" data-action="click-&gt;media#chooseForSlide" data-slide-index="${index}">Add image</button><button type="button" data-presentation-editor-action="delete-slide" data-slide-index="${index}"${slideCount === 1 ? " disabled" : ""}>Delete</button><button type="button" data-presentation-editor-action="move-slide-up" data-slide-index="${index}"${index === 0 ? " disabled" : ""}>Move up</button><button type="button" data-presentation-editor-action="move-slide-down" data-slide-index="${index}"${index === slideCount - 1 ? " disabled" : ""}>Move down</button></div>`,
  slideFrame: ({ index, layout, toolbar, topMargin, content, bottomMargin }) => `<div class="slide-frame" data-controller="presentation-canvas"><section class="slide slide-${layout}" data-presentation-canvas-target="canvas" aria-label="Slide ${index + 1}" data-editor-slide-id="slide-${index + 1}" data-slide-index="${index}">${toolbar}${topMargin}<div class="slide-content">${content}</div>${bottomMargin}</section></div>`,
  presentationRoot: ({ style, inner }) => `<div class="presentation-surface work-surface slides slides-theme-${style.theme} slides-typography-${style.typography} work-theme-${style.theme} work-typography-${style.typography} presentation-editor-projection" data-controller="mermaid-diagrams" data-presentation-editor-target="canvas">${inner}</div>`
}
