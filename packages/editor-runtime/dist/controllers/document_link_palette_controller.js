import { Controller } from "@hotwired/stimulus";
import { editorFor } from "../lib/editor_controller_lookup.js";
function scoreLinkTitle(title, query) {
  const value = title.toLowerCase();
  if (!query) return 0;
  if (value.startsWith(query)) return 0;
  const index = value.indexOf(query);
  return index === -1 ? null : index + 1;
}
function rankLinkTitles(titles, query) {
  return titles.map((title) => ({ title, score: scoreLinkTitle(title, query) })).filter((result) => result.score !== null).sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).map((result) => result.title);
}
function insideCode(source) {
  const lines = source.split("\n");
  let fenced = false;
  let fenceCharacter = null;
  let fenceLength = 0;
  for (const [index, line] of lines.entries()) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const fenceMarker = fence?.[1] ?? "";
    const fenceInfo = fence?.[2] ?? "";
    if (fenced) {
      if (fence && fenceMarker[0] === fenceCharacter && fenceMarker.length >= fenceLength && /^[ \t]*$/.test(fenceInfo)) {
        fenced = false;
      } else if (index === lines.length - 1) {
        return true;
      }
    } else if (fence) {
      fenced = true;
      fenceCharacter = fenceMarker[0] ?? "";
      fenceLength = fenceMarker.length;
      if (index === lines.length - 1) return true;
    } else if (index === lines.length - 1 && /^( {4}|\t)/.test(line)) {
      return true;
    }
  }
  if (fenced) return true;
  return insideInlineCode(lines.at(-1) ?? "");
}
function insideInlineCode(line) {
  let markerLength = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "`") continue;
    let length = 1;
    while (line[index + length] === "`") length += 1;
    if (markerLength === 0) markerLength = length;
    else if (length === markerLength) markerLength = 0;
    index += length - 1;
  }
  return markerLength > 0;
}
class document_link_palette_controller_default extends Controller {
  static targets = ["editor", "palette"];
  static values = { titles: Array };
  connect() {
    this.matches = [];
    this.selectedIndex = 0;
    this.positionPalette = this.positionPalette.bind(this);
    this.paletteTarget.setAttribute("aria-live", "polite");
    this.editorController = editorFor(this.element);
    this.editorReady = () => this.setupEditor();
    this.element.addEventListener("elef:editor-ready", this.editorReady);
    window.addEventListener("resize", this.positionPalette);
    this.setupEditor();
  }
  disconnect() {
    window.removeEventListener("resize", this.positionPalette);
    this.element.removeEventListener("elef:editor-ready", this.editorReady);
    if (this.nativeScrollBound) this.editorTarget.removeEventListener("scroll", this.positionPalette);
    if (this.scrollBound) this.editorController?.scrollElement.removeEventListener("scroll", this.positionPalette);
    if (this.keydownBound) this.editorController?.dom.removeEventListener("keydown", this.handleEditorKeydown, true);
  }
  setupEditor() {
    this.editorController ||= editorFor(this.element);
    if (this.editorController) this.setupAccessibility();
    if (this.editorController) {
      if (this.nativeScrollBound) {
        this.editorTarget.removeEventListener("scroll", this.positionPalette);
        this.nativeScrollBound = false;
      }
      if (!this.scrollBound) {
        this.editorController.scrollElement.addEventListener("scroll", this.positionPalette);
        this.scrollBound = true;
      }
      if (!this.keydownBound) {
        this.handleEditorKeydown = (event) => this.keydown(event);
        this.editorController.dom.addEventListener("keydown", this.handleEditorKeydown, true);
        this.keydownBound = true;
      }
    } else if (!this.nativeScrollBound) {
      this.editorTarget.addEventListener("scroll", this.positionPalette);
      this.nativeScrollBound = true;
    }
  }
  setupAccessibility() {
    const editor = this.editorController?.dom;
    if (!editor) return;
    const controls = new Set((editor.getAttribute("aria-controls") || "").split(/\s+/).filter(Boolean));
    controls.add(this.paletteTarget.id);
    editor.setAttribute("aria-controls", [...controls].join(" "));
    editor.setAttribute("aria-autocomplete", "list");
    this.updateAccessibility();
  }
  updateAccessibility() {
    const editor = this.editorController?.dom;
    if (!editor) return;
    const openPalette = [...this.element.querySelectorAll('[role="listbox"]')].find((palette) => !palette.hidden);
    editor.setAttribute("aria-expanded", String(Boolean(openPalette)));
    const selected = openPalette?.querySelector('[aria-selected="true"]');
    if (selected) editor.setAttribute("aria-activedescendant", selected.id);
    else editor.removeAttribute("aria-activedescendant");
  }
  input() {
    this.refresh();
  }
  keydown(event) {
    if (this.editorController && event.currentTarget === this.editorTarget) return;
    if (this.paletteTarget.hidden) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, Math.min(this.matches.length, 5) - 1);
      this.renderPalette();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.renderPalette();
    } else if (["Enter", "Tab"].includes(event.key)) {
      event.preventDefault();
      this.insertSelected();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    }
  }
  refresh() {
    const editor = this.editor();
    const beforeCaret = editor.value.slice(0, editor.selectionStart);
    const match = beforeCaret.match(/\[\[([^\]\r\n]*)$/);
    if (!match) return this.close();
    if (insideCode(beforeCaret)) return this.close();
    this.query = match[1]?.toLowerCase() ?? "";
    this.queryStart = editor.selectionStart - this.query.length - 2;
    this.matches = rankLinkTitles(this.titlesValue, this.query);
    this.selectedIndex = 0;
    this.renderPalette();
  }
  renderPalette() {
    this.paletteTarget.replaceChildren();
    this.matches.slice(0, 5).forEach((title, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.id = `${this.paletteTarget.id}-option-${index}`;
      option.setAttribute("aria-selected", String(index === this.selectedIndex));
      option.className = `document-link-option${index === this.selectedIndex ? " is-selected" : ""}`;
      option.textContent = title;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.selectedIndex = index;
        this.insertSelected();
      });
      this.paletteTarget.append(option);
    });
    this.paletteTarget.hidden = this.matches.length === 0;
    this.updateAccessibility();
    if (!this.paletteTarget.hidden) this.positionPalette();
  }
  positionPalette() {
    if (this.paletteTarget.hidden) return;
    if (this.editorController) {
      const editorRect2 = this.editorController.dom.getBoundingClientRect();
      const markerRect2 = this.editorController.view.coordsAtPos(this.editorController.selectionStart) || editorRect2;
      const paletteRect2 = this.paletteTarget.getBoundingClientRect();
      const left2 = Math.max(8, Math.min(markerRect2.left, window.innerWidth - paletteRect2.width - 8));
      const maxTop = Math.min(editorRect2.bottom - paletteRect2.height - 4, window.innerHeight - paletteRect2.height - 8);
      const top2 = Math.max(8, Math.min(markerRect2.bottom + 4, maxTop));
      this.paletteTarget.style.left = `${left2}px`;
      this.paletteTarget.style.top = `${top2}px`;
      return;
    }
    const editor = this.editorTarget;
    const editorRect = editor.getBoundingClientRect();
    const styles = getComputedStyle(editor);
    const mirror = document.createElement("div");
    const marker = document.createElement("span");
    mirror.setAttribute("aria-hidden", "true");
    Object.assign(mirror.style, {
      position: "fixed",
      visibility: "hidden",
      top: `${editorRect.top - editor.scrollTop}px`,
      left: `${editorRect.left - editor.scrollLeft}px`,
      width: `${editor.clientWidth}px`,
      boxSizing: "border-box",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      wordBreak: "break-word",
      font: styles.font,
      lineHeight: styles.lineHeight,
      letterSpacing: styles.letterSpacing,
      padding: styles.padding,
      border: styles.border
    });
    mirror.append(document.createTextNode(editor.value.slice(0, editor.selectionStart)), marker);
    document.body.append(mirror);
    const markerRect = marker.getBoundingClientRect();
    mirror.remove();
    const paletteRect = this.paletteTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(markerRect.left, window.innerWidth - paletteRect.width - 8));
    const top = Math.max(8, Math.min(markerRect.bottom + 4, window.innerHeight - paletteRect.height - 8));
    this.paletteTarget.style.left = `${left}px`;
    this.paletteTarget.style.top = `${top}px`;
  }
  insertSelected() {
    const title = this.matches[this.selectedIndex];
    if (!title) return this.close();
    const editor = this.editor();
    const before = editor.value.slice(0, this.queryStart);
    let end = editor.selectionStart;
    if (editor.value.slice(end, end + 2) === "]]") end += 2;
    const after = editor.value.slice(end);
    const insertion = `[[${title}]]`;
    const caret = before.length + insertion.length;
    if (this.editorController) {
      this.editorController.replaceRange(insertion, this.queryStart, end);
      this.editorController.focus();
      this.editorController.setSelectionRange(caret, caret);
    } else {
      editor.value = before + insertion + after;
      editor.focus();
      editor.setSelectionRange(caret, caret);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    this.close();
  }
  editor() {
    return this.editorController || this.editorTarget;
  }
  close() {
    this.paletteTarget.hidden = true;
    this.matches = [];
    this.updateAccessibility();
  }
  focusResult(event) {
    if (event.key !== "ArrowDown") return;
    this.paletteTarget.querySelector("button")?.focus();
  }
}
export {
  document_link_palette_controller_default as default,
  insideCode,
  insideInlineCode,
  rankLinkTitles,
  scoreLinkTitle
};
