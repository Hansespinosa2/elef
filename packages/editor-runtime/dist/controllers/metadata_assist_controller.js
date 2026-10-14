import { Controller } from "@hotwired/stimulus";
import { editorFor } from "../lib/editor_controller_lookup.js";
import {
  fieldScore,
  metadataCandidatesFor,
  metadataQueryAt,
  rankMetadataCandidates
} from "../lib/metadata_assist.js";
class metadata_assist_controller_default extends Controller {
  static targets = ["editor", "palette"];
  connect() {
    this.matches = [];
    this.selectedIndex = 0;
    this.query = null;
    this.queryStart = 0;
    this.editorController = editorFor(this.element);
    this.editorReady = () => this.setupEditor();
    this.element.addEventListener("elef:editor-ready", this.editorReady);
    this.editorForm = this.element.closest("form");
    this.editorModeChange = () => this.close();
    this.editorForm?.addEventListener("elef:editor-mode-change", this.editorModeChange);
    this.positionPalette = this.positionPalette.bind(this);
    this.paletteTarget.setAttribute("aria-live", "polite");
    this.setupEditor();
    window.addEventListener("resize", this.positionPalette);
  }
  disconnect() {
    window.removeEventListener("resize", this.positionPalette);
    if (this.scrollBound) this.editorController?.scrollElement.removeEventListener("scroll", this.positionPalette);
    if (this.keydownBound) this.editorController?.dom.removeEventListener("keydown", this.handleEditorKeydown, true);
    this.element.removeEventListener("elef:editor-ready", this.editorReady);
    this.editorForm?.removeEventListener("elef:editor-mode-change", this.editorModeChange);
    this.close();
  }
  setupEditor() {
    const editor = editorFor(this.element);
    if (editor !== this.editorController) {
      if (this.scrollBound) this.editorController?.scrollElement.removeEventListener("scroll", this.positionPalette);
      if (this.keydownBound) this.editorController?.dom.removeEventListener("keydown", this.handleEditorKeydown, true);
      this.editorController = editor;
      this.scrollBound = false;
      this.keydownBound = false;
      this.close();
    }
    if (this.editorController) this.setupAccessibility();
    if (this.editorController && !this.scrollBound) {
      this.editorController.scrollElement.addEventListener("scroll", this.positionPalette);
      this.scrollBound = true;
    }
    if (this.editorController && !this.keydownBound) {
      this.handleEditorKeydown = (event) => this.keydown(event);
      this.editorController.dom.addEventListener("keydown", this.handleEditorKeydown, true);
      this.keydownBound = true;
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
    if (event.defaultPrevented) return;
    const editor = this.editorController;
    if (!editor || editor.editingMode !== "source") {
      this.close();
      return;
    }
    if (this.paletteTarget.hidden) {
      if (event.key === "Escape") this.close();
      else queueMicrotask(() => this.refresh());
      return;
    }
    const query = metadataQueryAt(editor.value, editor.selectionStart);
    if (editor.selectionStart !== editor.selectionEnd || !query || query.start !== this.queryStart || query.text !== this.query?.text || query.kind !== this.query?.kind) {
      this.close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, Math.min(this.matches.length, 5) - 1);
      this.renderPalette();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.renderPalette();
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.insertSelected();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    } else {
      queueMicrotask(() => this.refresh());
    }
  }
  refresh() {
    const editor = this.editorController;
    if (!editor || editor.editingMode !== "source") return this.close();
    if (editor.selectionStart !== editor.selectionEnd) return this.close();
    const query = metadataQueryAt(editor.value, editor.selectionStart);
    if (!query) return this.close();
    const matches = rankMetadataCandidates(metadataCandidatesFor(query), query.text);
    if (!matches.length) return this.close();
    this.query = query;
    this.queryStart = query.start;
    this.matches = matches;
    this.selectedIndex = 0;
    this.renderPalette();
  }
  renderPalette() {
    this.paletteTarget.replaceChildren();
    this.matches.slice(0, 5).forEach((candidate, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.id = `${this.paletteTarget.id}-option-${index}`;
      option.setAttribute("aria-selected", String(index === this.selectedIndex));
      option.className = `snippet-option${index === this.selectedIndex ? " is-selected" : ""}`;
      const trigger = document.createElement("strong");
      trigger.textContent = this.displayFor(candidate);
      const details = document.createElement("span");
      details.textContent = this.detailFor(candidate);
      option.append(trigger, details);
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
  displayFor(candidate) {
    if (this.query?.kind === "key") return candidate;
    return `${this.query?.key}: ${candidate}`;
  }
  detailFor(candidate) {
    if (this.query?.kind === "key") {
      if (candidate === "show-in-margin") return "Margin settings \xB7 section";
      if (candidate === "section" || candidate === "subsection" || candidate === "footnote" || candidate === "slide-count" || candidate === "slide_count") return "Margin setting \xB7 boolean";
      return "Appearance \xB7 front matter";
    }
    return "Metadata value";
  }
  positionPalette() {
    if (this.paletteTarget.hidden) return;
    const editor = this.editorController;
    if (!editor) return;
    const editorRect = editor.dom.getBoundingClientRect();
    const markerRect = editor.view.coordsAtPos(editor.selectionStart) || editorRect;
    const paletteRect = this.paletteTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(markerRect.left, window.innerWidth - paletteRect.width - 8));
    const maxTop = window.innerHeight - paletteRect.height - 8;
    const belowTop = markerRect.bottom + 4;
    const aboveTop = markerRect.top - paletteRect.height - 4;
    const top = belowTop <= maxTop ? belowTop : Math.max(8, Math.min(aboveTop, maxTop));
    this.paletteTarget.style.left = `${left}px`;
    this.paletteTarget.style.top = `${top}px`;
  }
  insertSelected() {
    const candidate = this.matches[this.selectedIndex];
    const query = this.query;
    const editor = this.editorController;
    if (!candidate || !query || !editor) return this.close();
    const caret = editor.selectionStart;
    if (query.kind === "key") {
      editor.replaceRange(`${candidate}: `, this.queryStart, caret);
    } else {
      editor.replaceRange(candidate, this.queryStart, caret);
    }
    this.close();
    editor.focus();
    queueMicrotask(() => this.refresh());
  }
  close() {
    this.paletteTarget.hidden = true;
    this.matches = [];
    this.query = null;
    this.updateAccessibility();
  }
}
export {
  metadata_assist_controller_default as default,
  fieldScore
};
