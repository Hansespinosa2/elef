import { Controller } from "@hotwired/stimulus";
import { mediaInsertText } from "@elef/work-model/document-transforms";
import { bindEditorAction } from "../lib/editor_actions.js";
const IMAGE_TYPES_BY_EXTENSION = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp"
};
function imageTypeForFilename(filename = "") {
  const extension = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  return extension && IMAGE_TYPES_BY_EXTENSION[extension] || null;
}
async function imageTypeFromContents(file) {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const startsWith = (...signature) => signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
  if (startsWith(255, 216, 255)) return "image/jpeg";
  const gifSignature = new TextDecoder().decode(bytes.slice(0, 6));
  if (["GIF87a", "GIF89a"].includes(gifSignature)) return "image/gif";
  if (startsWith(66, 77)) return "image/bmp";
  if (startsWith(73, 73, 42, 0) || startsWith(77, 77, 0, 42)) return "image/tiff";
  const header = new TextDecoder().decode(bytes);
  if (header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP") return "image/webp";
  const brand = header.slice(8, 16);
  if (header.slice(4, 8) === "ftyp") {
    if (/avif|avis/.test(brand)) return "image/avif";
    if (/heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(brand)) return "image/heic";
  }
  if (/^(?:\uFEFF)?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(header)) {
    return "image/svg+xml";
  }
  return null;
}
function isMediaTransferTypes(types) {
  const list = Array.from(types || []);
  return list.includes("Files") || list.includes("application/x-moz-file") || list.includes("text/uri-list") || list.includes("public.url") || list.some((type) => typeof type === "string" && type.startsWith("image/"));
}
function urlFromTransfer(transfer) {
  if (!transfer) return null;
  const html = transfer.getData?.("text/html");
  if (html) {
    if (typeof DOMParser !== "undefined") {
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const img = doc.querySelector("img");
        if (img?.src) return img.src;
      } catch (_e) {
      }
    } else {
      const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (match?.[1]) return match[1];
    }
  }
  const uriList = transfer.getData?.("text/uri-list");
  if (uriList) {
    const uri = uriList.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
    if (uri) return uri;
  }
  const plain = transfer.getData?.("text/plain")?.trim();
  if (plain && (/^https?:\/\//i.test(plain) || /^data:image\//i.test(plain) || /^blob:/i.test(plain))) {
    return plain;
  }
  return null;
}
class media_controller_default extends Controller {
  static targets = ["input", "fit", "status"];
  static values = { uploadUrl: String, enabled: Boolean, workKind: String };
  connect() {
    this.pendingRange = null;
    this.targetSlideIndex = null;
    this.unbindEditorActions = bindEditorAction(this.element, "media-choose-slide", (event, control) => this.chooseForSlide(event, control));
  }
  disconnect() {
    this.unbindEditorActions?.();
  }
  filesFromTransfer(transfer) {
    const files = Array.from(transfer?.files || []);
    if (files.length) return files;
    for (const item of Array.from(transfer?.items || [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile?.();
      if (file) files.push(file);
    }
    return files;
  }
  choose() {
    this.targetSlideIndex = null;
    const editor = this.editor;
    this.pendingRange = editor ? { from: editor.selectionStart, to: editor.selectionEnd } : null;
    this.inputTarget.click();
  }
  chooseForSlide(event, control = null) {
    event.preventDefault();
    event.stopPropagation();
    const target = control ?? event.currentTarget;
    const index = target instanceof HTMLElement ? target.dataset.slideIndex : void 0;
    this.targetSlideIndex = index !== void 0 && index !== "" ? Number(index) : null;
    this.pendingRange = null;
    this.inputTarget.click();
  }
  async selected() {
    const file = this.inputTarget.files?.[0];
    this.inputTarget.value = "";
    if (!file) return;
    const range = this.rangeForTargetSlide() || this.pendingRange;
    this.targetSlideIndex = null;
    this.pendingRange = null;
    await this.upload(file, range);
  }
  paste(event) {
    const sourcePaste = this.isSourceEditorTarget(event.target);
    const visualPaste = this.isVisualEditorTarget(event.target);
    if (!sourcePaste && !visualPaste) return;
    const files = this.filesFromTransfer(event.clipboardData);
    if (!files.length) return;
    const editor = this.editor;
    if (!editor?.view) {
      this.setStatus("The editor is not ready yet. Try again in a moment.");
      return;
    }
    event.preventDefault();
    if (sourcePaste) {
      const rangeId = editor.trackMediaRange({ from: editor.selectionStart, to: editor.selectionEnd });
      this.insertSourceImage(files, rangeId);
      return;
    }
    const file = files[0];
    if (!file) {
      this.setStatus("Choose an image file to insert into source mode.");
      return;
    }
    const eventElement = event.target instanceof Element ? event.target : null;
    const slideElement = document.activeElement?.closest?.("[data-slide-index], [data-editor-slide-id]") || eventElement?.closest?.("[data-slide-index], [data-editor-slide-id]");
    let targetIndex = null;
    if (slideElement) {
      targetIndex = this.slideIndexFromElement(slideElement);
    }
    const range = targetIndex !== null ? this.rangeForSlide(targetIndex) : editor ? { from: editor.selectionStart, to: editor.selectionEnd } : null;
    this.upload(file, range);
  }
  sourceDragOver(event) {
    const transfer = event.dataTransfer;
    const types = Array.from(transfer?.types || []);
    if (!this.isSourceEditorTarget(event.currentTarget) || !isMediaTransferTypes(types)) return;
    if (!this.editor?.view) {
      this.setStatus("The source editor is not ready yet. Try dropping the image again in a moment.");
      return;
    }
    event.preventDefault();
    if (transfer) transfer.dropEffect = "copy";
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    target.classList.add("is-media-drop-target");
  }
  sourceDragLeave(event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    if (target.contains(event.relatedTarget)) return;
    target.classList.remove("is-media-drop-target");
  }
  async sourceDrop(event) {
    if (!this.isSourceEditorTarget(event.currentTarget)) return;
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const types = Array.from(transfer.types || []);
    if (!isMediaTransferTypes(types)) return;
    const editor = this.editor;
    if (!editor?.view) {
      this.setStatus("The source editor is not ready yet. Try dropping the image again in a moment.");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (target instanceof HTMLElement) target.classList.remove("is-media-drop-target");
    const position = editor.view.posAtCoords({ x: event.clientX, y: event.clientY });
    const fallback = editor.selectionEnd;
    const range = { from: position ?? fallback, to: position ?? fallback };
    const rangeId = editor.trackMediaRange(range);
    const files = this.filesFromTransfer(transfer);
    if (files.length) {
      await this.insertSourceImage(files, rangeId);
      return;
    }
    await this.insertSourceTransfer(transfer, rangeId);
  }
  async insertSourceTransfer(transfer, rangeId) {
    this.setStatus("Preparing image\u2026", true);
    try {
      const url = urlFromTransfer(transfer);
      const file = url ? await this.fileFromUrl(url) : null;
      if (!file) {
        this.editor?.releaseMediaRange(rangeId);
        this.setStatus("Only image files can be dropped here \u2014 to use an image from a web page, save it first.");
        return;
      }
      await this.insertSourceImage([file], rangeId);
    } catch (_error) {
      this.editor?.releaseMediaRange(rangeId);
      this.setStatus("Only image files can be dropped here \u2014 to use an image from a web page, save it first.");
    }
  }
  async fileFromUrl(url) {
    if (!url) return null;
    try {
      const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(5e3) : void 0;
      const response = await fetch(url, signal ? { signal } : {});
      if (!response.ok) return null;
      const blob = await response.blob();
      let type = blob.type || "";
      if (!type.startsWith("image/")) {
        type = imageTypeForFilename(url) || await imageTypeFromContents(blob);
      }
      if (!type?.startsWith("image/")) return null;
      let filename = "dropped-image";
      try {
        const baseHref = globalThis.window?.location?.href || "http://localhost";
        const parsed = new URL(url, baseHref);
        const base = parsed.pathname.split("/").pop();
        if (base && /\.[a-z0-9]+$/i.test(base)) {
          filename = decodeURIComponent(base);
        }
      } catch (_e) {
      }
      return new File([blob], filename, { type });
    } catch (_error) {
      return null;
    }
  }
  isSourceEditorTarget(target) {
    const sourceSurface = target instanceof Element ? target.closest(".editor-surface") : null;
    const mode = this.editor?.editingMode || this.element.dataset.editorMode;
    return mode === "source" && Boolean(sourceSurface);
  }
  isVisualEditorTarget(target) {
    const mode = this.editor?.editingMode || this.element.dataset.editorMode;
    return mode === "visual" && Boolean(target instanceof Element ? target.closest(".editor-projection") : null);
  }
  async fileForSourceUpload(file) {
    const declaredType = file.type || "";
    let type;
    if (declaredType.startsWith("image/")) {
      type = declaredType;
    } else if (["", "application/octet-stream"].includes(declaredType)) {
      type = imageTypeForFilename(file.name) || await imageTypeFromContents(file);
    } else {
      return null;
    }
    if (!type?.startsWith("image/")) return null;
    const knownExtension = Object.entries(IMAGE_TYPES_BY_EXTENSION).find(([, mimeType]) => mimeType === type)?.[0];
    const filenameExtension = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
    const extension = knownExtension || filenameExtension;
    if (!extension) return null;
    const filenameType = imageTypeForFilename(file.name);
    let name = file.name || "pasted-image";
    if (filenameType !== type || !filenameExtension) {
      if (filenameExtension) name = name.slice(0, -(filenameExtension.length + 1));
      name = `${name || "pasted-image"}.${extension}`;
    }
    if (name === file.name && type === file.type) return file;
    return new File([file], name, { type, lastModified: file.lastModified });
  }
  async insertSourceImage(files, rangeId) {
    this.setStatus("Preparing image\u2026", true);
    try {
      let image = null;
      for (const file of files) {
        image = await this.fileForSourceUpload(file);
        if (image) break;
      }
      if (!image) {
        this.editor?.releaseMediaRange(rangeId);
        this.setStatus("Choose an image file to insert into source mode.");
        return;
      }
      await this.upload(image, null, { rangeId });
    } catch (error) {
      this.editor?.releaseMediaRange(rangeId);
      this.setStatus(error instanceof Error ? error.message || "Media could not be uploaded." : "Media could not be uploaded.");
    }
  }
  dragOver(event) {
    const transfer = event.dataTransfer;
    if (!transfer || !Array.from(transfer.types || []).includes("Files")) return;
    event.preventDefault();
    transfer.dropEffect = "copy";
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    target.classList.add("is-media-drop-target");
  }
  dragLeave(event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    if (target.contains(event.relatedTarget)) return;
    target.classList.remove("is-media-drop-target");
  }
  async drop(event) {
    const transfer = event.dataTransfer;
    if (!transfer?.files?.length) return;
    event.preventDefault();
    const target = event.currentTarget;
    if (target instanceof HTMLElement) target.classList.remove("is-media-drop-target");
    const targetElement = event.target instanceof Element ? event.target : null;
    const slideElement = targetElement?.closest?.("[data-slide-index], [data-editor-slide-id]");
    const targetIndex = slideElement ? this.slideIndexFromElement(slideElement) : null;
    const editor = this.editor;
    const range = targetIndex !== null ? this.rangeForSlide(targetIndex) : this.rangeAtSelectedSlideEnd(editor);
    const file = transfer.files[0];
    if (!file) return;
    await this.upload(file, range);
  }
  slideIndexFromElement(element) {
    const dataset = element.dataset;
    if (dataset.slideIndex !== void 0 && dataset.slideIndex !== "") {
      return Number(dataset.slideIndex);
    }
    const match = dataset.editorSlideId?.match(/slide-(\d+)/);
    return match ? Number(match[1] ?? "") - 1 : null;
  }
  async ensurePersisted() {
    if (this.enabledValue && this.uploadUrlValue) return true;
    const form = this.element.closest("form") || this.element;
    const kind = this.hasWorkKindValue ? this.workKindValue : "presentation";
    const fallbackTitle = kind === "document" ? "Untitled document" : "Untitled presentation";
    const title = form.querySelector(`input[name="${kind}[title]"]`)?.value || fallbackTitle;
    const source = this.editor?.value || form.querySelector(`textarea[name="${kind}[source]"]`)?.value || "";
    const theme = form.querySelector(`select[name="${kind}[theme]"]`)?.value || "";
    const typography = form.querySelector(`select[name="${kind}[typography]"]`)?.value || "";
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
    const body = new FormData();
    body.append(`${kind}[title]`, title);
    body.append(`${kind}[source]`, source);
    body.append(`${kind}[theme]`, theme);
    body.append(`${kind}[typography]`, typography);
    body.append("editor_mode", form.querySelector('[name="editor_mode"]')?.value || "visual");
    const response = await fetch(form.action, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken
      },
      body
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.errors?.join(", ") || `Failed to save new ${kind} before upload.`);
    }
    const data = await response.json();
    this.enabledValue = true;
    this.uploadUrlValue = data.upload_url;
    const workUrl = data.upload_url.replace(/\/assets\/?$/, "");
    if (form) {
      form.action = workUrl;
      let methodInput = form.querySelector('input[name="_method"]');
      if (!methodInput) {
        methodInput = document.createElement("input");
        methodInput.type = "hidden";
        methodInput.name = "_method";
        methodInput.value = "patch";
        form.prepend(methodInput);
      }
      let lockInput = form.querySelector(`input[name="${kind}[lock_version]"]`);
      if (!lockInput) {
        lockInput = document.createElement("input");
        lockInput.type = "hidden";
        lockInput.name = `${kind}[lock_version]`;
        form.prepend(lockInput);
      }
      lockInput.value = data.lock_version ?? 0;
      let baseRevInput = form.querySelector(`input[name="${kind}[base_revision]"]`);
      if (!baseRevInput) {
        baseRevInput = document.createElement("input");
        baseRevInput.type = "hidden";
        baseRevInput.name = `${kind}[base_revision]`;
        form.prepend(baseRevInput);
      }
      baseRevInput.value = data.revision_token || "";
      let sessionInput = form.querySelector(`input[name="${kind}[edit_session_id]"]`);
      if (!sessionInput) {
        sessionInput = document.createElement("input");
        sessionInput.type = "hidden";
        sessionInput.name = `${kind}[edit_session_id]`;
        sessionInput.value = typeof globalThis.crypto?.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        form.prepend(sessionInput);
      }
      const previewController = this.application.getControllerForElementAndIdentifier(this.element, "preview");
      if (previewController) {
        previewController.urlValue = `${workUrl}/preview`;
      }
      const autosaveController = this.application.getControllerForElementAndIdentifier(this.element, "autosave");
      if (autosaveController) {
        autosaveController.workIdValue = data.id;
        autosaveController.saveEnabledValue = true;
        autosaveController.updateRevisionTokens(data);
      }
    }
    window.history.replaceState({}, "", data.edit_url || `${workUrl}/edit`);
    return true;
  }
  async upload(file, range, { rangeId = null } = {}) {
    const fileName = file.name || "pasted-image";
    this.setStatus(`${this.enabledValue && this.uploadUrlValue ? "Uploading" : "Preparing"} ${fileName}\u2026`, true);
    try {
      if (!this.enabledValue || !this.uploadUrlValue) {
        await this.ensurePersisted();
      }
      this.setStatus(`Uploading ${fileName}\u2026`, true);
      const body = new FormData();
      body.append("file", file, file.name);
      body.append("fit", this.hasFitTarget ? this.fitTarget.value : "contain");
      const response = await fetch(this.uploadUrlValue, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || ""
        },
        body
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Media could not be uploaded.");
      this.application.getControllerForElementAndIdentifier(this.element, "autosave")?.updateRevisionTokens(result);
      const editor = this.editor;
      if (!editor) throw new Error("The Markdown editor is not ready yet.");
      const trackedRange = rangeId === null ? null : editor.consumeMediaRange(rangeId);
      if (rangeId !== null && !trackedRange) throw new Error("The source editor changed before the image finished uploading.");
      const insertionPoint = trackedRange || range || { from: editor.selectionStart, to: editor.selectionEnd };
      const markdown = mediaInsertText(editor.value, insertionPoint, result.source);
      editor.replaceRange(markdown, insertionPoint.from, insertionPoint.to);
      editor.focus();
      this.setStatus(`${fileName} added to the Markdown source.`);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message || "Media could not be uploaded." : "Media could not be uploaded.");
    } finally {
      if (rangeId !== null) this.editor?.releaseMediaRange(rangeId);
    }
  }
  rangeForTargetSlide() {
    return this.rangeForSlide(this.targetSlideIndex);
  }
  rangeForSlide(slideIndex) {
    if (slideIndex === null || slideIndex === void 0) return null;
    const editor = this.editor;
    if (!editor) return null;
    const ranges = this.slideOverview?.sourceRanges(editor.value) || [];
    const range = ranges[slideIndex];
    if (!range) return null;
    const slideContent = editor.value.slice(range.start, range.end).trim();
    if (slideContent.length === 0) {
      return { from: range.start, to: range.end };
    }
    return { from: range.end, to: range.end };
  }
  rangeAtSelectedSlideEnd(editor) {
    if (!editor) return null;
    const ranges = this.slideOverview?.sourceRanges(editor.value) || [];
    const selected = Number(this.element.dataset.selectedSlideIndex || 0);
    const range = ranges[selected];
    return range ? { from: range.end, to: range.end } : { from: editor.selectionEnd, to: editor.selectionEnd };
  }
  setStatus(message, busy = false) {
    if (!this.hasStatusTarget) return;
    this.statusTarget.textContent = message;
    this.statusTarget.setAttribute("aria-busy", String(busy));
  }
  get editor() {
    return this.element.querySelector("[data-controller~='editor']")?.editorController;
  }
  get slideOverview() {
    return this.application.getControllerForElementAndIdentifier(this.element, "slide-overview");
  }
}
export {
  media_controller_default as default,
  imageTypeForFilename,
  imageTypeFromContents,
  isMediaTransferTypes,
  urlFromTransfer
};
