// Client-owned HTML sanitizer for renderer output: the implementation behind
// the SafeHtml insertion boundary. Faithful port of the retired
// app/javascript lib (parity-proven by the shared
// test/javascript/shared/preview_sanitizer_cases.js corpus, executed against
// this implementation through the host-side re-export); the only deliberate
// difference is that mediaBaseUrl is an explicit option — the old host-form
// dataset fallback stays with the host-side re-export until the editor
// (Phase 08) and settings (Phase 05) slices migrate.

const ALLOWED_ELEMENTS = new Set([
  "A", "ANNOTATION", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
  "HR", "IMG", "LI", "MATH", "MFRAC", "MI", "MN", "MO", "MROW", "MSUB", "MSUP", "MTEXT", "MTABLE", "MTD",
  "MTR", "MOVER", "MUNDER", "MUNDEROVER", "MSQRT", "MROOT", "MSTYLE", "MSPACE", "OL", "P", "PRE", "SECTION",
  "BUTTON", "FIGCAPTION", "FIGURE", "LABEL", "OPTION", "SELECT", "SEMANTICS", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL", "VIDEO", "WBR",
]);
const INTERACTIVE_ELEMENTS = new Set(["BUTTON", "LABEL", "OPTION", "SELECT"]);
const MATH_DELIMITERS = new Set(["$", "$$", "\\(", "\\)", "\\[", "\\]"]);
const SAFE_PROTOCOLS = /^(?:https?:|mailto:|tel:|#|\/|\.\.?\/|[^:]*$)/i;
const ALLOWED_ACTIONS = new Set([
  "input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur",
  "input->presentation-editor#blockInput focus->presentation-editor#blockFocus blur->presentation-editor#blockBlur",
  "click->media#chooseForSlide",
  "pointerdown->visual-editor#positionControlOpened",
  "focus->visual-editor#positionControlOpened keydown->visual-editor#positionControlKeydown change->visual-editor#alignmentChanged",
  "change->presentation-editor#alignmentChanged",
]);
const ALLOWED_PRESENTATION_ACTIONS = new Set([
  "add-slide-after", "delete-slide", "move-slide-up", "move-slide-down", "add-block-after", "delete-block", "move-block-up", "move-block-down",
]);

export interface SanitizeOptions {
  readonly interactive?: boolean;
  readonly documentPagination?: boolean;
  readonly mediaBaseUrl?: string;
}

export function sanitizePreview(container: Element, html: string, options: SanitizeOptions = {}): void {
  const { interactive = true, documentPagination = false, mediaBaseUrl = "" } = options;
  const document = container.ownerDocument;
  const template = document.createElement("template");
  template.innerHTML = typeof html === "string" ? html : "";
  const showElement = document.defaultView?.NodeFilter?.SHOW_ELEMENT ?? 1;
  const walker = document.createTreeWalker(template.content, showElement);
  const elements: Element[] = [];
  while (walker.nextNode()) elements.push(walker.currentNode as Element);

  for (const element of elements) {
    if (
      !ALLOWED_ELEMENTS.has(element.tagName) ||
      (!interactive && INTERACTIVE_ELEMENTS.has(element.tagName)) ||
      (element.tagName === "BUTTON" && !safePreviewButton(element, interactive))
    ) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (!safeAttribute(element, attribute.name, attribute.value, interactive, documentPagination, mediaBaseUrl)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  container.replaceChildren(template.content);
}

function safeAttribute(
  element: Element,
  name: string,
  value: string,
  interactive: boolean,
  documentPagination: boolean,
  mediaBaseUrl: string,
): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("on") || lower === "srcdoc" || lower === "formaction") return false;
  if (
    ["class", "role", "alt", "title", "aria-label", "aria-multiline", "aria-readonly", "aria-hidden", "spellcheck", "controls", "playsinline", "preload", "colspan", "rowspan"].includes(lower)
  ) {
    return true;
  }
  if (lower === "type") return element.tagName === "BUTTON" && value === "button";
  if (lower === "disabled") return ["BUTTON", "SELECT"].includes(element.tagName) && value === "";
  if (lower === "selected") return element.tagName === "OPTION" && value === "";
  if (lower === "value") {
    return (
      element.tagName === "OPTION" &&
      /^(?:left|center|right|top left|top center|top right|center left|center center|center right|bottom left|bottom center|bottom right)$/.test(value)
    );
  }
  if (lower === "contenteditable") return interactive && (value === "true" || value === "false");
  if (["xmlns", "display", "encoding"].includes(lower) && ["MATH", "ANNOTATION"].includes(element.tagName)) return true;
  if (lower === "style") return isSafeKatexStyle(element, value);
  if (lower.startsWith("aria-") && /^[a-z-]+$/.test(lower)) return true;
  if (lower === "data-action") return interactive && ALLOWED_ACTIONS.has(value);
  if (lower === "data-controller") {
    if (interactive) {
      return value.split(/\s+/).every((controller) => ["mermaid-diagrams", "presentation-canvas", "document-pages"].includes(controller));
    }
    return (
      documentPagination &&
      element.parentNode?.nodeType === 11 &&
      element.classList.contains("document-reader") &&
      value === "document-pages mermaid-diagrams"
    );
  }
  if (lower === "data-presentation-editor-action") {
    return interactive && element.tagName === "BUTTON" && ALLOWED_PRESENTATION_ACTIONS.has(value);
  }
  if (lower === "data-block-index" || lower === "data-slide-index") return interactive && /^(?:0|[1-9]\d*)$/.test(value);
  if (lower === "data-presentation-editor-align") return interactive && element.tagName === "SELECT" && value === "";
  if (lower === "data-visual-editor-block-id") return interactive && element.tagName === "SELECT" && /^[A-Za-z0-9_-]+$/.test(value);
  if (lower === "data-editor-image-source") return value === "true";
  if (["data-editor-block-id", "data-editor-region-id"].includes(lower)) return /^[A-Za-z0-9_-]+$/.test(value);
  if (lower === "data-editor-empty-block") return value === "true";
  if (lower === "data-editor-source-editable") return value === "true" || value === "false";
  if (lower === "data-editor-slide-id") return /^slide-\d+$/.test(value);
  if (lower === "data-editor-math-source") {
    return (
      element.tagName === "SPAN" &&
      ["katex", "katex-display", "math-error"].some((className) => element.classList.contains(className))
    );
  }
  if (lower === "data-editor-math-open" || lower === "data-editor-math-close") return MATH_DELIMITERS.has(value);
  if (lower === "data-presentation-canvas-target") return interactive && element.tagName === "SECTION" && value === "canvas";
  if (lower === "data-presentation-editor-target") {
    return interactive && element.tagName === "DIV" && element.classList.contains("presentation-surface") && value === "canvas";
  }
  if (lower === "data-document-pages-target") {
    const reader = element.parentElement;
    return (
      (interactive || (documentPagination && reader?.parentNode?.nodeType === 11)) &&
      value === "surface" &&
      element.classList.contains("document-surface") &&
      (reader?.classList.contains("document-reader") ?? false)
    );
  }
  if (lower === "href" && element.tagName === "A") return safeUrl(value);
  if (lower === "src" && ["IMG", "VIDEO"].includes(element.tagName)) {
    return (safeUrl(value) || isWithinMediaBase(value, mediaBaseUrl)) && !/^(?:https?:|data:|javascript:)/i.test(value);
  }
  return false;
}

function safePreviewButton(element: Element, interactive: boolean): boolean {
  if (!interactive || element.getAttribute("type") !== "button") return false;
  return (
    ALLOWED_PRESENTATION_ACTIONS.has(element.getAttribute("data-presentation-editor-action") ?? "") ||
    element.getAttribute("data-action") === "click->media#chooseForSlide"
  );
}

function safeUrl(value: string): boolean {
  const trimmed = value.trim();
  return SAFE_PROTOCOLS.test(trimmed) && !/^(?:javascript|data|vbscript):/i.test(trimmed);
}

function isWithinMediaBase(value: string, mediaBaseUrl: string): boolean {
  if (mediaBaseUrl === "") return false;
  try {
    const media = new URL(value);
    const base = new URL(mediaBaseUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    return (
      media.protocol === base.protocol &&
      media.hostname === base.hostname &&
      media.port === base.port &&
      media.username === "" &&
      media.password === "" &&
      media.search === "" &&
      media.hash === "" &&
      basePath !== "" &&
      media.pathname.startsWith(`${basePath}/`)
    );
  } catch {
    return false;
  }
}

function isSafeKatexStyle(element: Element, value: string): boolean {
  if (["TD", "TH"].includes(element.tagName)) {
    return /^(?:text-align\s*:\s*)(?:left|center|right)\s*;?$/.test(value.trim());
  }
  if (element.closest(".katex") === null) return false;
  const safeProperties = new Set([
    "height", "width", "vertical-align", "top", "left", "margin-right", "margin-left", "font-size",
    "position", "display", "white-space", "overflow", "padding-left", "border-bottom-width", "border-bottom-style",
  ]);
  return value
    .split(";")
    .filter(Boolean)
    .every((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 0) return false;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const cssValue = declaration.slice(separator + 1).trim();
      return safeProperties.has(property) && /^[a-zA-Z0-9().,%+\-\s]+$/.test(cssValue);
  });
}
