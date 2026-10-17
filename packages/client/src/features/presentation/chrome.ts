// Presentation chrome for the shared renderer: slide shells, toolbars and
// controls wrapped around @elef/renderer projection output. Split from the
// retired preview_chrome.js alongside the document-editor chrome now owned by
// the shared editor runtime. Hook attributes are host-neutral contracts:
// behavior binds through `data-editor-action` / `data-client-mount` (see
// packages/editor-runtime/src/lib/editor_actions.ts and client_mounts.ts);
// the client feature
// handles block input, focus, and alignment natively, so no Stimulus
// `data-action` is emitted here.
import { presentationTheme } from "@elef/work-model/style-vocab"

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function presentationSlideToolbar({ index, slideCount }: { index: number; slideCount: number }): string {
  return `<div class="presentation-editor-slide-toolbar" aria-label="Slide ${index + 1} controls"><span class="presentation-editor-slide-label">Slide ${index + 1}</span><button type="button" data-presentation-editor-action="add-slide-after" data-slide-index="${index}">Add slide</button><button type="button" class="presentation-editor-add-image" data-editor-action="media-choose-slide" data-slide-index="${index}">Add image</button><button type="button" data-presentation-editor-action="delete-slide" data-slide-index="${index}"${slideCount === 1 ? " disabled" : ""}>Delete</button><button type="button" data-presentation-editor-action="move-slide-up" data-slide-index="${index}"${index === 0 ? " disabled" : ""}>Move up</button><button type="button" data-presentation-editor-action="move-slide-down" data-slide-index="${index}"${index === slideCount - 1 ? " disabled" : ""}>Move down</button></div>`
}

export function presentationSlideFrame({ index, layout, toolbar, topMargin, content, bottomMargin, artHost, revealEventCount }: { index: number; layout: string; toolbar: string; topMargin: string; content: string; bottomMargin: string; artHost?: boolean; revealEventCount?: number }): string {
  const revealCountAttribute = (revealEventCount ?? 0) > 0 ? ` data-elef-reveal-event-count="${revealEventCount}"` : ""
  const hostAttribute = artHost ? ` data-art-host="fixed" data-art-overfull="false"` : ""
  return `<div class="slide-frame"><section class="slide slide-${layout}"${revealCountAttribute} aria-label="Slide ${index + 1}" data-editor-slide-id="slide-${index + 1}" data-slide-index="${index}">${toolbar}${topMargin}<div class="slide-content"${hostAttribute}>${content}</div>${bottomMargin}</section></div>`
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

export function presentationBlockControls({ slideIndex, blockIndex, position }: { slideIndex: number; blockIndex: number; blockCount: number; position?: ChromeBlockPosition | null }): string {
  const alignment = position ? (position.vertical === "top" ? position.horizontal : `${position.vertical} ${position.horizontal}`) : "left"
  const options = ["top", "middle", "bottom"].flatMap(vertical => ["left", "center", "right"].map(horizontal => {
    const value = vertical === "top" ? horizontal : `${vertical} ${horizontal}`
    return `<option value="${value}"${value === alignment ? " selected" : ""}>${value.split(" ").map(part => (part[0] ?? "").toUpperCase() + part.slice(1)).join(" ")}</option>`
  })).join("")
  // One shared alignment pill per block (mirroring documents): block
  // structure moved to keyboard (Enter/Backspace/Alt+Arrow) and the
  // Edit-actions menu, so no permanent buttons take layout here.
  return `<div class="presentation-editor-block-controls" aria-label="Block alignment"><label>Align <select aria-label="Block alignment" data-presentation-editor-align data-slide-index="${slideIndex}" data-block-index="${blockIndex}">${options}</select></label></div>`
}

export function presentationSlideBlock({ className, attributes, content, controls, revealEvent }: { className: string; attributes: string; content: string; controls: string; revealEvent?: number }): string {
  const revealAttribute = revealEvent === undefined ? "" : ` data-elef-reveal-event="${revealEvent}"`
  // The shell is the positioned flex item (mirroring the document block
  // shell): it carries the block's position classes for alignment and hosts
  // the absolutely-positioned alignment pill, so controls never shift layout.
  const tokens = className.split(" ").filter(Boolean)
  const positionClasses = tokens.filter((token) => token.startsWith("position-")).join(" ")
  const titleShell = tokens.includes("slide-title") ? " slide-title-shell" : ""
  const shellClass = ["slide-block-shell", positionClasses].filter(Boolean).join(" ")
  return `<div class="${shellClass}${titleShell}"><div class="${className}" ${attributes}${revealAttribute}>${content}</div>${controls}</div>`
}

export function presentationEmptyBlock({ mapped }: { mapped: { id: string; editable_region_id?: string } }): string {
  if (!mapped.editable_region_id) return ""
  return `<div class="slide-block slide-empty-block" data-editor-block-id="${mapped.id}" data-editor-region-id="${mapped.editable_region_id}" data-editor-source-editable="true" data-editor-empty-block="true" contenteditable="true" role="textbox" aria-label="Editable slide block" aria-multiline="true" spellcheck="true"><p><br></p></div>`
}

export function presentationEmptySlide({ index }: { index: number }): string {
  return `<div class="empty-slide"><p>Empty slide</p><button type="button" class="button secondary empty-slide-add-image" data-editor-action="media-choose-slide" data-slide-index="${index}">Add image</button></div>`
}

export function presentationRoot({ style, inner, artController }: { style: { theme: string; typography: string }; inner: string; artController?: boolean }): string {
  const mounts = artController ? "mermaid art-layout" : "mermaid"
  return `<div class="presentation-surface work-surface slides slides-theme-${style.theme} slides-typography-${style.typography} slides-presentation-${presentationTheme(style.theme, style.typography)} work-theme-${style.theme} work-typography-${style.typography} presentation-editor-projection" data-client-mount="${mounts}" data-presentation-editor-target="canvas">${inner}</div>`
}

export { escapeHtml as escapePresentationHtml }
