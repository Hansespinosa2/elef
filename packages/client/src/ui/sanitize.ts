// Client-owned HTML sanitizer for renderer output: the implementation behind
// the SafeHtml insertion boundary and the single insertion path for both
// hosts (proven by the shared
// apps/web/test/javascript/shared/preview_sanitizer_cases.js corpus, executed
// directly against this implementation). mediaBaseUrl is an explicit option;
// hosts pass their own base URL and keep no sanitizer of their own.
import { markStage } from "../session/stage_marks.js"

const ALLOWED_ELEMENTS = new Set([
  "A", "ANNOTATION", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
  "HR", "IMG", "LI", "MATH", "MENCLOSE", "MFRAC", "MGLYPH", "MI", "MN", "MO", "MPADDED", "MPHANTOM", "MROW", "MSPACE",
  "MSQRT", "MROOT", "MSTYLE", "MSUB", "MSUBSUP", "MSUP", "MTEXT", "MTABLE", "MTD",
  "MTR", "MOVER", "MUNDER", "MUNDEROVER", "OL", "P", "PRE", "SECTION",
  "BUTTON", "FIGCAPTION", "FIGURE", "LABEL", "OPTION", "SELECT", "SEMANTICS", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL", "VIDEO", "WBR",
]);
// Inert MathML presentation attributes emitted by KaTeX's mathml output (no
// URLs, no script; src is deliberately excluded so mglyph cannot fetch
// external images). Compared case-insensitively.
const MATHML_ATTRIBUTES = new Set([
  "accent", "accentunder", "align", "columnalign", "columnlines", "columnspacing", "depth", "displaystyle",
  "fence", "frame", "framespacing", "height", "largeop", "linebreak", "linethickness", "lspace", "mathbackground",
  "mathcolor", "mathsize", "mathvariant", "maxsize", "minlabelspacing", "minsize", "movablelimits", "notation", "rowalign",
  "rowlines", "rowspacing", "rspace", "scriptlevel", "separator", "stretchy", "symmetric", "valign", "voffset", "width",
]);
const MATHML_ELEMENTS = new Set([
  "MATH", "MENCLOSE", "MFRAC", "MGLYPH", "MI", "MN", "MO", "MPADDED", "MPHANTOM", "MROW", "MSPACE",
  "MSQRT", "MROOT", "MSTYLE", "MSUB", "MSUBSUP", "MSUP", "MTEXT", "MTABLE", "MTD",
  "MTR", "MOVER", "MUNDER", "MUNDEROVER", "SEMANTICS", "ANNOTATION",
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
// Host-neutral behavior contracts emitted by the client (Phase 09): hosts bind
// these natively instead of through Stimulus action strings. The legacy
// entries above stay until the server authoring partials are deleted.
const ALLOWED_EDITOR_ACTIONS = new Set(["media-choose-slide", "overview-select"]);
const ALLOWED_CLIENT_MOUNTS = new Set(["mermaid", "document-pages", "art-layout"]);
const ALLOWED_PRESENTATION_ACTIONS = new Set([
  "add-slide-after", "delete-slide", "move-slide-up", "move-slide-down",
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
  markStage("sanitize-parse-start");
  template.innerHTML = typeof html === "string" ? html : "";
  markStage("sanitize-parse-end");
  markStage("sanitize-scrub-start");
  const showElement = document.defaultView?.NodeFilter?.SHOW_ELEMENT ?? 1;
  const walker = document.createTreeWalker(template.content, showElement);
  const elements: Element[] = [];
  while (walker.nextNode()) elements.push(walker.currentNode as Element);

  for (const element of elements) {
    // Foreign (MathML/SVG) elements keep their lowercase tagName; compare
    // case-insensitively so the renderer's MathML output survives.
    const tag = element.tagName.toUpperCase();
    if (
      !ALLOWED_ELEMENTS.has(tag) ||
      (!interactive && INTERACTIVE_ELEMENTS.has(tag)) ||
      (tag === "BUTTON" && !safePreviewButton(element, interactive))
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
  markStage("sanitize-scrub-end");
  markStage("sanitize-install-start");
  container.replaceChildren(template.content);
  markStage("sanitize-install-end");
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
  const tag = element.tagName.toUpperCase();
  if (lower.startsWith("on") || lower === "srcdoc" || lower === "formaction") return false;
  if (MATHML_ATTRIBUTES.has(lower) && MATHML_ELEMENTS.has(tag)) return true;
  if (
    ["class", "role", "alt", "title", "aria-label", "aria-multiline", "aria-readonly", "aria-hidden", "spellcheck", "controls", "playsinline", "preload", "colspan", "rowspan"].includes(lower)
  ) {
    return true;
  }
  if (lower === "type") return tag === "BUTTON" && value === "button";
  if (lower === "disabled") return ["BUTTON", "SELECT"].includes(tag) && value === "";
  if (lower === "selected") return tag === "OPTION" && value === "";
  if (lower === "value") {
    return (
      tag === "OPTION" &&
      /^(?:left|center|right|top left|top center|top right|middle left|middle center|middle right|bottom left|bottom center|bottom right)$/.test(value)
    );
  }
  if (lower === "start") return tag === "OL" && /^(?:0|[1-9]\d*)$/.test(value);
  if (lower === "contenteditable") return interactive && (value === "true" || value === "false");
  if (["xmlns", "display", "encoding"].includes(lower) && ["MATH", "ANNOTATION"].includes(tag)) return true;
  if (lower === "style") return isSafeKatexStyle(element, value);
  if (lower.startsWith("aria-") && /^[a-z-]+$/.test(lower)) return true;
  if (lower === "data-action") return interactive && ALLOWED_ACTIONS.has(value);
  if (lower === "data-editor-action") return interactive && ALLOWED_EDITOR_ACTIONS.has(value);
  if (lower === "data-client-mount") {
    return interactive && value.split(/\s+/).every((mount) => ALLOWED_CLIENT_MOUNTS.has(mount));
  }
  if (lower === "data-controller") {
    if (interactive) {
      return value.split(/\s+/).every((controller) => ["mermaid-diagrams", "presentation-canvas", "document-pages", "art-layout"].includes(controller));
    }
    return (
      documentPagination &&
      element.parentNode?.nodeType === 11 &&
      element.classList.contains("document-reader") &&
      value === "document-pages mermaid-diagrams"
    );
  }
  if (lower === "data-presentation-editor-action") {
    return interactive && tag === "BUTTON" && ALLOWED_PRESENTATION_ACTIONS.has(value);
  }
  if (lower === "data-block-index" || lower === "data-slide-index") return interactive && /^(?:0|[1-9]\d*)$/.test(value);
  if (lower === "data-presentation-editor-align") return interactive && tag === "SELECT" && value === "";
  if (lower === "data-visual-editor-block-id") return interactive && tag === "SELECT" && /^[A-Za-z0-9_-]+$/.test(value);
  if (lower === "data-editor-image-source") return value === "true";
  if (["data-editor-block-id", "data-editor-region-id"].includes(lower)) return /^[A-Za-z0-9_-]+$/.test(value);
  if (lower === "data-editor-empty-block") return value === "true";
  if (lower === "data-editor-source-editable") return value === "true" || value === "false";
  if (lower === "data-editor-slide-id") return /^slide-\d+$/.test(value);
  if (lower === "data-editor-math-source") {
    return (
      tag === "SPAN" &&
      ["katex", "katex-display", "math-error"].some((className) => element.classList.contains(className))
    );
  }
  if (lower === "data-editor-math-open" || lower === "data-editor-math-close") return MATH_DELIMITERS.has(value);
  if (lower === "data-elef-art-root") return value === "";
  if (lower === "data-art-mode") return ["peers", "sequence"].includes(value);
  if (lower === "data-art-density") return ["compact", "rich"].includes(value);
  if (lower === "data-art-status") return ["ready", "pending", "fallback-unsupported", "fallback-no-fit", "error"].includes(value);
  if (lower === "data-art-layout") return ["peers-wrap", "sequence-horizontal", "sequence-vertical", "plain-list"].includes(value);
  if (lower === "data-art-settled" || lower === "data-art-overfull") return value === "true" || value === "false";
  if (lower === "data-art-host") return value === "fixed";
  if (lower === "data-art-diagnostic") return ["ART_NO_LIST_TARGET", "ART_INVALID_SYNTAX", "ART_UNSUPPORTED_CONTENT", "ART_REVEAL_BOUNDARY", "ART_NO_FIT", "ART_ITEM_TOO_TALL", "ART_INTERNAL_ERROR"].includes(value);
  if (lower === "data-elef-reveal-event") return tag === "DIV" && element.classList.contains("slide-block") && /^(?:0|[1-9]\d*)$/.test(value);
  if (lower === "data-elef-reveal-event-count") return tag === "SECTION" && element.classList.contains("slide") && /^[1-9]\d*$/.test(value);
  if (lower === "data-presentation-canvas-target") return interactive && tag === "SECTION" && value === "canvas";
  if (lower === "data-presentation-editor-target") {
    return interactive && tag === "DIV" && element.classList.contains("presentation-surface") && value === "canvas";
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
  if (lower === "href" && tag === "A") return safeUrl(value);
  if (lower === "src" && ["IMG", "VIDEO"].includes(tag)) {
    return (safeUrl(value) || isWithinMediaBase(value, mediaBaseUrl)) && !/^(?:https?:|data:|javascript:)/i.test(value);
  }
  return false;
}

function safePreviewButton(element: Element, interactive: boolean): boolean {
  if (!interactive || element.getAttribute("type") !== "button") return false;
  return (
    ALLOWED_PRESENTATION_ACTIONS.has(element.getAttribute("data-presentation-editor-action") ?? "") ||
    element.getAttribute("data-action") === "click->media#chooseForSlide" ||
    element.getAttribute("data-editor-action") === "media-choose-slide"
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
