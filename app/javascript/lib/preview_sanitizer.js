const ALLOWED_ELEMENTS = new Set([
  "A", "ANNOTATION", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
  "HR", "IMG", "LI", "MATH", "MFRAC", "MI", "MN", "MO", "MROW", "MSUB", "MSUP", "MTEXT", "MTABLE", "MTD",
  "MTR", "MOVER", "MUNDER", "MUNDEROVER", "MSQRT", "MROOT", "MSTYLE", "MSPACE", "OL", "P", "PRE", "SECTION",
  "BUTTON", "FIGCAPTION", "FIGURE", "LABEL", "OPTION", "SELECT", "SEMANTICS", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL", "VIDEO", "WBR"
])
const SAFE_PROTOCOLS = /^(?:https?:|mailto:|tel:|elefasset:|#|\/|\.\.?\/|[^:]*$)/i
const ALLOWED_ACTIONS = new Set([
  "input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur",
  "input->presentation-editor#blockInput focus->presentation-editor#blockFocus blur->presentation-editor#blockBlur",
  "click->media#chooseForSlide",
  "pointerdown->visual-editor#positionControlOpened",
  "focus->visual-editor#positionControlOpened keydown->visual-editor#positionControlKeydown change->visual-editor#alignmentChanged",
  "change->presentation-editor#alignmentChanged"
])
const ALLOWED_PRESENTATION_ACTIONS = new Set([
  "add-slide-after", "delete-slide", "move-slide-up", "move-slide-down", "add-block-after", "delete-block", "move-block-up", "move-block-down"
])

export function installSanitizedPreview(container, html, { interactive = true, documentPagination = false } = {}) {
  const template = container.ownerDocument.createElement("template")
  template.innerHTML = typeof html === "string" ? html : ""
  const walker = container.ownerDocument.createTreeWalker(template.content, container.ownerDocument.defaultView?.NodeFilter?.SHOW_ELEMENT || 1)
  const elements = []
  while (walker.nextNode()) elements.push(walker.currentNode)

  for (const element of elements) {
    if (!ALLOWED_ELEMENTS.has(element.tagName)) {
      element.remove()
      continue
    }
    for (const attribute of [...element.attributes]) {
      if (!safeAttribute(element, attribute.name, attribute.value, interactive, documentPagination)) element.removeAttribute(attribute.name)
    }
  }
  container.replaceChildren(template.content)
}

function safeAttribute(element, name, value, interactive, documentPagination) {
  const lower = name.toLowerCase()
  if (lower.startsWith("on") || lower === "srcdoc" || lower === "formaction") return false
  if (["class", "role", "alt", "title", "aria-label", "aria-multiline", "aria-readonly", "aria-hidden", "spellcheck", "controls", "playsinline", "preload", "colspan", "rowspan"].includes(lower)) return true
  if (lower === "type") return element.tagName === "BUTTON" && value === "button"
  if (lower === "disabled") return ["BUTTON", "SELECT"].includes(element.tagName) && value === ""
  if (lower === "selected") return element.tagName === "OPTION" && value === ""
  if (lower === "value") return element.tagName === "OPTION" && /^(?:left|center|right|top left|top center|top right|center left|center center|center right|bottom left|bottom center|bottom right)$/.test(value)
  if (lower === "contenteditable") return interactive && (value === "true" || value === "false")
  if (["xmlns", "display", "encoding"].includes(lower) && ["MATH", "ANNOTATION"].includes(element.tagName)) return true
  if (lower === "style") return isSafeKatexStyle(element, value)
  if (lower.startsWith("aria-") && /^[a-z-]+$/.test(lower)) return true
  if (lower === "data-action") return interactive && ALLOWED_ACTIONS.has(value)
  if (lower === "data-controller") {
    if (interactive) return value.split(/\s+/).every((controller) => ["mermaid-diagrams", "presentation-canvas", "document-pages"].includes(controller))
    return documentPagination && element.parentNode?.nodeType === 11 && element.classList.contains("document-reader") && value === "document-pages mermaid-diagrams"
  }
  if (lower === "data-presentation-editor-action") return interactive && ALLOWED_PRESENTATION_ACTIONS.has(value)
  if (lower === "data-block-index" || lower === "data-slide-index") return interactive && /^(?:0|[1-9]\d*)$/.test(value)
  if (lower === "data-presentation-editor-align") return interactive && element.tagName === "SELECT" && value === ""
  if (lower === "data-visual-editor-block-id") return interactive && element.tagName === "SELECT" && /^[A-Za-z0-9_-]+$/.test(value)
  if (/^data-(?:editor|presentation-canvas)/.test(lower)) return true
  if (lower === "data-document-pages-target") {
    const reader = element.parentElement
    return (interactive || (documentPagination && reader?.parentNode?.nodeType === 11)) && value === "surface" && element.classList.contains("document-surface") && reader?.classList.contains("document-reader")
  }
  if (lower === "href" && element.tagName === "A") return safeUrl(value)
  if (lower === "src" && ["IMG", "VIDEO"].includes(element.tagName)) return safeUrl(value) && !/^(?:https?:|data:|javascript:)/i.test(value)
  if (lower === "data-editor-image-source") return value === "true"
  return false
}

function safeUrl(value) {
  const trimmed = value.trim()
  return SAFE_PROTOCOLS.test(trimmed) && !/^(?:javascript|data|vbscript):/i.test(trimmed)
}

function isSafeKatexStyle(element, value) {
  if (["TD", "TH"].includes(element.tagName)) return /^(?:text-align\s*:\s*)(?:left|center|right)\s*;?$/i.test(value.trim())
  if (!element.closest(".katex")) return false
  const safeProperties = new Set(["height", "width", "vertical-align", "top", "left", "margin-right", "margin-left", "font-size", "position", "display", "white-space", "overflow", "padding-left", "border-bottom-width", "border-bottom-style"])
  return value.split(";").filter(Boolean).every((declaration) => {
    const separator = declaration.indexOf(":")
    if (separator < 0) return false
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const cssValue = declaration.slice(separator + 1).trim()
    return safeProperties.has(property) && /^[a-zA-Z0-9().,%+\-\s]+$/.test(cssValue)
  })
}
