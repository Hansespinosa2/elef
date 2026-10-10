// Presentation chrome for the shared renderer: slide shells, toolbars and
// controls wrapped around @elef/renderer projection output. Moved from
// apps/web/app/javascript/lib/preview_chrome.js (which keeps the document-editor
// chrome for Phase 09). Hook attributes are host-neutral contracts:
// behavior binds through `data-editor-action` / `data-client-mount` (see
// lib/editor_actions.js and lib/client_mounts.js); the client feature
// handles block input, focus, and alignment natively, so no Stimulus
// `data-action` is emitted here.

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function presentationSlideToolbar({ index, slideCount }: { index: number; slideCount: number }): string {
  return `<div class="presentation-editor-slide-toolbar" aria-label="Slide ${index + 1} controls"><span class="presentation-editor-slide-label">Slide ${index + 1}</span><button type="button" data-presentation-editor-action="add-slide-after" data-slide-index="${index}">Add slide</button><button type="button" class="presentation-editor-add-image" data-editor-action="media-choose-slide" data-slide-index="${index}">Add image</button><button type="button" data-presentation-editor-action="delete-slide" data-slide-index="${index}"${slideCount === 1 ? " disabled" : ""}>Delete</button><button type="button" data-presentation-editor-action="move-slide-up" data-slide-index="${index}"${index === 0 ? " disabled" : ""}>Move up</button><button type="button" data-presentation-editor-action="move-slide-down" data-slide-index="${index}"${index === slideCount - 1 ? " disabled" : ""}>Move down</button></div>`
}

export function presentationSlideFrame({ index, layout, toolbar, topMargin, content, bottomMargin }: { index: number; layout: string; toolbar: string; topMargin: string; content: string; bottomMargin: string }): string {
  return `<div class="slide-frame"><section class="slide slide-${layout}" aria-label="Slide ${index + 1}" data-editor-slide-id="slide-${index + 1}" data-slide-index="${index}">${toolbar}${topMargin}<div class="slide-content">${content}</div>${bottomMargin}</section></div>`
}

export function presentationBlockAttributes({ valid, mapped, region, label }: { valid: boolean; mapped: { id: string } | null | undefined; region: { id: string; editable?: boolean } | null | undefined; label: string }): string {
  // The renderer passes possibly-unmapped blocks; only valid+resolved triples
  // are editable. (The renderer guarantees resolved-when-valid, so the extra
  // disjuncts only turn a would-be TypeError into graceful degradation.)
  if (!valid || !mapped || !region) return "contenteditable=\"false\" aria-readonly=\"true\""
  const editable = region.editable
    ? ` contenteditable="true" role="textbox" aria-label="${label}" aria-multiline="true" spellcheck="true"`
    : " contenteditable=\"false\" aria-readonly=\"true\""
  return `data-editor-block-id="${mapped.id}" data-editor-region-id="${region.id}" data-editor-source-editable="${region.editable}"${editable}`
}

export interface ChromeBlockPosition {
  horizontal: string
  vertical: string
}

export function presentationBlockControls({ slideIndex, blockIndex, blockCount, position }: { slideIndex: number; blockIndex: number; blockCount: number; position?: ChromeBlockPosition | null }): string {
  const alignment = position ? (position.vertical === "top" ? position.horizontal : `${position.vertical === "middle" ? "center" : position.vertical} ${position.horizontal}`) : "left"
  const options = ["top", "middle", "bottom"].flatMap(vertical => ["left", "center", "right"].map(horizontal => {
    const value = vertical === "top" ? horizontal : `${vertical === "middle" ? "center" : vertical} ${horizontal}`
    return `<option value="${value}"${value === alignment ? " selected" : ""}>${value.split(" ").map(part => (part[0] ?? "").toUpperCase() + part.slice(1)).join(" ")}</option>`
  })).join("")
  return `<div class="presentation-editor-block-controls" aria-label="Block controls"><button type="button" data-presentation-editor-action="add-block-after" data-slide-index="${slideIndex}" data-block-index="${blockIndex}">Add block</button><button type="button" data-presentation-editor-action="delete-block" data-slide-index="${slideIndex}" data-block-index="${blockIndex}"${blockCount === 1 ? " disabled" : ""}>Delete</button><button type="button" aria-label="Move block up" data-presentation-editor-action="move-block-up" data-slide-index="${slideIndex}" data-block-index="${blockIndex}"${blockIndex === 0 ? " disabled" : ""}>↑</button><button type="button" aria-label="Move block down" data-presentation-editor-action="move-block-down" data-slide-index="${slideIndex}" data-block-index="${blockIndex}"${blockIndex === blockCount - 1 ? " disabled" : ""}>↓</button><label>Align <select aria-label="Block alignment" data-presentation-editor-align data-slide-index="${slideIndex}" data-block-index="${blockIndex}">${options}</select></label></div>`
}

export function presentationSlideBlock({ className, attributes, content, controls }: { className: string; attributes: string; content: string; controls: string }): string {
  return `<div class="${className}" ${attributes}>${content}</div>${controls}`
}

export function presentationEmptySlide({ index }: { index: number }): string {
  return `<div class="empty-slide"><p>Empty slide</p><button type="button" class="button secondary empty-slide-add-image" data-editor-action="media-choose-slide" data-slide-index="${index}">Add image</button></div>`
}

export function presentationRoot({ style, inner }: { style: { theme: string; typography: string }; inner: string }): string {
  return `<div class="presentation-surface work-surface slides slides-theme-${style.theme} slides-typography-${style.typography} work-theme-${style.theme} work-typography-${style.typography} presentation-editor-projection" data-client-mount="mermaid" data-presentation-editor-target="canvas">${inner}</div>`
}

export { escapeHtml as escapePresentationHtml }
