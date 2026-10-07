import { expect, test } from "@playwright/test"
import { editAndPreviewWorkflow, SAVED_SOURCE } from "../../../test/e2e/scenarios/edit-and-preview.js"
import { appearanceWorkflow } from "../../../test/e2e/scenarios/appearance.js"
import { libraryAndGraphWorkflow } from "../../../test/e2e/scenarios/library-and-graph.js"
import { libraryCreateDeleteWorkflow } from "../../../test/e2e/scenarios/library-create-delete.js"
import { externalEditConflictWorkflow, CONFLICT_EXTERNAL_SOURCE } from "../../../test/e2e/scenarios/external-edit-conflict.js"
import { hostileDeckNeutralizedWorkflow } from "../../../test/e2e/scenarios/hostile-deck.js"
import { documentLinkCompletionWorkflow, mathInputWorkflow, snippetInsertWorkflow } from "../../../test/e2e/scenarios/authoring-palettes.js"
import { authoringSettingsWorkflow } from "../../../test/e2e/scenarios/authoring-settings.js"
import { PIXEL_PNG_MARKDOWN } from "../../../test/e2e/scenarios/media-fixture.js"
import { presentationModeWorkflow } from "../../../test/e2e/scenarios/presentation-mode.js"
import { vimRelativeLineNumbersWorkflow } from "../../../test/e2e/scenarios/vim-relative-line-numbers.js"
import { documentPageAspectRatioWorkflow } from "../../../test/e2e/scenarios/document-page-aspect-ratio.js"
import { displayMathEnterWorkflow } from "../../../test/e2e/scenarios/display-math-enter.js"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { readFile } from "node:fs/promises"
import { renderPreview } from "../../../app/javascript/lib/renderer.js"

function normalizeLineEndings(source) {
  return source.replace(/\r\n|\r/g, "\n")
}

async function renderedTextWithoutEditorControls(locator) {
  return locator.evaluate(container => {
    const preview = container.cloneNode(true)
    preview.querySelectorAll(".presentation-editor-slide-toolbar, .presentation-editor-block-controls, button, select")
      .forEach(control => control.remove())
    return preview.textContent.replace(/\s+/g, " ").trim()
  })
}

class WebEditorUi {
  async setAppearance(key, value) {
    const panel = this.page.locator(".appearance-settings")
    if (!await panel.evaluate(element => element.open)) await panel.locator("summary").click()
    await panel.locator(`[data-appearance-target='${key}']`).selectOption(value)
    await expect.poll(() => this.readSource()).toMatch(new RegExp(`^${key}: ${value}$`, "m"))
    await expect(this.page.locator(`[class*='slides-${key}-${value}']`)).toBeVisible()
  }

  async assertAppearance(theme, typography) {
    await expect(this.page.locator(`.slides-theme-${theme}.slides-typography-${typography}`)).toBeVisible()
  }

  constructor(page) {
    this.page = page
    this.rejectExternalMedia = false
    this.activeWorkId = null
  }

  async openDeck(title = "E2E seed") {
    if (title === "E2E hostile") {
      await this.page.route("https://example.invalid/**", route => route.abort())
    }
    const isDocument = title === "E2E document"
    const id = isDocument
      ? process.env.ELEF_E2E_DOCUMENT_ID
      : title === "E2E conflict"
      ? process.env.ELEF_E2E_CONFLICT_PRESENTATION_ID
      : title === "E2E hostile"
        ? process.env.ELEF_E2E_HOSTILE_PRESENTATION_ID
        : process.env.ELEF_E2E_PRESENTATION_ID
    if (!id) throw new Error(`The shared web scenario requires an E2E ${isDocument ? "document" : "presentation"} fixture`)
    this.activeWorkId = id
    const path = isDocument ? "documents" : "presentations"
    await this.page.goto(`/${path}/${id}/edit`)
    await expect(this.page.locator(".visual-editor-form")).toHaveAttribute("data-editor-mode", "visual")
    await expect(this.page.locator(".source-field .cm-content")).toBeVisible()
  }

  async enableVimRelativeLineNumbers() {
    await this.page.goto("/settings")
    const vimToggle = this.page.locator("[data-vim-settings-target='vimToggle']")
    if (!await vimToggle.isChecked()) await vimToggle.check()
    await this.page.locator("[data-vim-settings-target='lineNumbers']").selectOption("relative")
  }

  async openAuthoringSettings() {
    await this.page.goto("/snippets")
    await expect(this.page.locator("#authoring-settings-dialog")).toBeVisible()
  }

  async closeAuthoringSettings() {
    await Promise.all([
      this.page.waitForURL("**/settings"),
      this.page.locator("#close-authoring-settings").click()
    ])
    await expect(this.page.locator("#authoring-settings-dialog")).toBeHidden()
  }

  async selectAuthoringRegistry(registry) {
    const tab = this.page.locator(`[data-authoring-tab='${registry}']`)
    await tab.click()
    await expect(tab).toHaveAttribute("aria-selected", "true")
  }

  async assertBuiltInAuthoringEntryReadOnly(name) {
    const card = this.page.locator(".authoring-entry-card").filter({ hasText: name })
    await expect(card).toContainText("Built-in")
    await expect(card.locator(".authoring-entry-actions")).toHaveCount(0)
  }

  async createAuthoringEntry(registry, fields) {
    await this.page.locator("#new-authoring-entry").click()
    await this.fillAuthoringEntryForm(registry, fields)
    await this.page.locator("#save-authoring-entry").click()
    const label = registry === "snippets" ? "snippet" : "math shortcut"
    await expect(this.page.locator("#authoring-settings-status")).toHaveText(`New entry saved (${label}).`)
  }

  async editAuthoringEntry(registry, searchText, fields) {
    const card = this.page.locator(".authoring-entry-card").filter({ hasText: searchText })
    await expect(card).toHaveCount(1)
    await card.locator(".authoring-entry-actions button").filter({ hasText: "Edit" }).click()
    await this.fillAuthoringEntryForm(registry, fields)
    await this.page.locator("#save-authoring-entry").click()
    const label = registry === "snippets" ? "snippet" : "math shortcut"
    await expect(this.page.locator("#authoring-settings-status")).toHaveText(`Changes saved (${label}).`)
  }

  async deleteAuthoringEntry(registry, searchText) {
    const card = this.page.locator(".authoring-entry-card").filter({ hasText: searchText })
    await expect(card).toHaveCount(1)
    await card.locator(".authoring-delete").click()
    await expect(this.page.locator("#delete-authoring-dialog")).toBeVisible()
    await this.page.locator("#confirm-authoring-delete").click()
    const label = registry === "snippets" ? "snippet" : "math shortcut"
    await expect(this.page.locator("#authoring-settings-status")).toHaveText(`Entry deletion saved (${label}).`)
  }

  async assertAuthoringEntryVisible(searchText) {
    await expect(this.page.locator(".authoring-entry-card").filter({ hasText: searchText })).toHaveCount(1)
  }

  async assertAuthoringEntryMissing(searchText) {
    await expect(this.page.locator(".authoring-entry-card").filter({ hasText: searchText })).toHaveCount(0)
  }

  async fillAuthoringEntryForm(registry, fields) {
    if (registry === "snippets") {
      await this.page.locator("#authoring-name").fill(fields.name)
      await this.page.locator("#authoring-trigger").fill(fields.trigger)
      await this.page.locator("#authoring-description").fill(fields.description)
      await this.page.locator("#authoring-category").selectOption(fields.category)
      await this.page.locator("#authoring-body").fill(fields.body)
      return
    }
    await this.page.locator("#authoring-math-name").fill(fields.name)
    await this.page.locator("#authoring-prefix").selectOption(fields.prefix)
    await this.page.locator("#authoring-aliases").fill(fields.aliases)
    await this.page.locator("#authoring-math-description").fill(fields.description)
    await this.page.locator("#authoring-expansion").fill(fields.expansion)
  }

  async enterPresentationMode() {
    if (!this.activeWorkId) throw new Error("Open a presentation deck before entering presentation mode")
    await this.page.goto(`/presentations/${this.activeWorkId}/present`)
    await expect(this.page.locator(".presentation-stage .slide-frame")).toHaveCount(2)
  }

  async assertPresentationSlide(index, title) {
    const slides = this.page.locator(".presentation-stage > .slide-frame")
    await expect(slides).toHaveCount(2)
    await expect(slides.nth(index)).toBeVisible()
    await expect(slides.nth(index)).toContainText(title)
    await expect(slides.nth(1 - index)).toBeHidden()
  }

  async movePresentation(key) {
    await this.page.keyboard.press(key)
  }

  async exitPresentationMode() {
    await this.returnToEditor()
  }

  async returnToEditor() {
    if (this.activeWorkId && !this.page.url().includes(`/presentations/${this.activeWorkId}/edit`)) {
      await this.page.goto(`/presentations/${this.activeWorkId}/edit`)
      await expect(this.page.locator(".visual-editor-form")).toHaveAttribute("data-editor-mode", "visual")
      await expect(this.page.locator(".source-field .cm-content")).toBeVisible()
    }
  }

  async reopenDeck() {
    await this.openDeck()
  }

  async renameEditorTitle(title) {
    await this.page.locator(".editor-title-input").fill(title)
  }

  async waitForEditorTitle(title) {
    const input = this.page.locator(".editor-title-input")
    await expect(input).toHaveValue(title)
    await this.waitForSaved()
  }

  async assertEditorTitle(title) {
    await expect(this.page.locator(".editor-title-input")).toHaveValue(title)
  }

  async replaceSource(source) {
    const editor = this.page.locator(".source-field .cm-content")
    await editor.click()
    await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
    await this.page.keyboard.insertText(source)
  }

  async restoreSource(source) {
    await this.showSourceMode()
    const restoredSource = await this.page.locator(".source-field").evaluate((field, nextSource) => {
      const controller = field.editorController
      if (!controller) return null
      controller.replaceRange(nextSource, 0, controller.view.state.doc.length)
      controller.setSelectionRange(nextSource.length)
      return controller.sourceValue
    }, source)
    expect(restoredSource).toBe(source)
  }

  async readSource() {
    return this.page.locator(".source-field").evaluate(field => field.editorController?.sourceValue ?? "")
  }

  async setCaretPosition(position) {
    const selection = await this.page.locator(".source-field").evaluate((field, offset) => {
      const controller = field.editorController
      if (!controller) return null
      controller.setSelectionRange(offset)
      return [controller.selectionStart, controller.selectionEnd]
    }, position)
    expect(selection).toEqual([position, position])
  }

  async assertBackspaceDeletesEmptyDollarPair(expectedSource) {
    const source = normalizeLineEndings(expectedSource)
    const initialState = await this.page.locator(".source-field").evaluate((field, expected) => {
      const controller = field.editorController
      if (!controller || controller.value !== `${expected}$$`) return null
      controller.setSelectionRange(expected.length + 1)
      controller.focus()
      return { vimEnabled: controller.vimEnabled, insertMode: controller.insertMode }
    }, source)
    expect(initialState).not.toBeNull()

    const restoreNormalMode = initialState.vimEnabled && !initialState.insertMode
    try {
      if (restoreNormalMode) {
        await this.page.keyboard.press("i")
        await expect.poll(() => this.page.locator(".source-field").evaluate(field => field.editorController.insertMode)).toBe(true)
      }

      const outcome = await this.page.locator(".source-field").evaluate(field => {
        const controller = field.editorController
        const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
        controller.dom.dispatchEvent(event)
        return {
          source: controller.value,
          anchor: controller.selectionStart,
          head: controller.selectionEnd,
          prevented: event.defaultPrevented
        }
      })
      expect(outcome).toEqual({
        source,
        anchor: source.length,
        head: source.length,
        prevented: true
      })
    } finally {
      if (restoreNormalMode) {
        await this.page.keyboard.press("Escape")
        await expect.poll(() => this.page.locator(".source-field").evaluate(field => field.editorController.insertMode)).toBe(false)
      }
    }
  }

  async assertRelativeLineNumbers() {
    const result = await this.page.locator(".source-field").evaluate(async field => {
      const editor = field.editorController
      if (!editor) return { error: "The shared CodeMirror controller is unavailable" }
      const source = editor.sourceValue
      const selection = editor.view.state.selection.main
      const mode = editor.lineNumberMode
      const vimEnabled = editor.vimEnabled
      const values = () => [...editor.view.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
        .filter(element => element.style.visibility !== "hidden")
        .map(element => element.textContent)
      const twoFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      try {
        editor.loadDocument("One\ntwo\nthree\nfour")
        editor.setSelectionRange(0)
        await twoFrames()
        const firstLineActive = values()
        editor.setSelectionRange(editor.view.state.doc.line(3).from)
        await twoFrames()
        return { mode, vimEnabled, firstLineActive, thirdLineActive: values() }
      } finally {
        editor.loadDocument(source)
        editor.setLineNumberMode(mode)
        editor.view.dispatch({ selection })
        await twoFrames()
      }
    })

    expect(result).toEqual({
      mode: "relative",
      vimEnabled: true,
      firstLineActive: ["0", "1", "2", "3"],
      thirdLineActive: ["2", "1", "0", "1"]
    })
  }

  async assertCaretPosition(position) {
    await expect.poll(() => this.page.locator(".source-field").evaluate(field => [
      field.editorController?.selectionStart,
      field.editorController?.selectionEnd
    ])).toEqual([position, position])
  }

  async typeEmptyDisplayMath(mode) {
    const delimiterInput = mode === "visual" ? "$$" : "$$$$"
    const expectedPairSource = `${await this.readSource()}${delimiterInput}`
    if (mode === "visual") {
      const block = this.page.locator(".document-editor-block[contenteditable='true']").last()
      await expect(block).toBeVisible()
      await block.click()
      await block.pressSequentially("$")
      await block.pressSequentially("$")
      await expect.poll(() => this.readSource()).toBe(expectedPairSource)
      await this.page.locator(".document-editor-block[contenteditable='true']").last().press("Enter")
      return
    }

    const editor = this.page.locator(".source-field .cm-content")
    await editor.click()
    await editor.press("ControlOrMeta+End")
    await editor.pressSequentially("$")
    await editor.pressSequentially("$")
    await expect.poll(() => this.readSource()).toBe(expectedPairSource)
    await editor.press("Enter")
  }

  async assertDisplayMathCaret(expectedSource, expectedCaret, mode) {
    const visual = mode === "visual"
    await expect.poll(() => this.page.locator(".source-field").evaluate((field, expected) => {
      const form = field.closest("form")
      const editor = field.editorController
      const selection = window.getSelection()
      const focusElement = selection?.focusNode?.nodeType === Node.ELEMENT_NODE
        ? selection.focusNode
        : selection?.focusNode?.parentElement
      const activeMath = focusElement?.closest?.(".editor-math-active")
      return {
        value: editor?.value,
        selectionStart: editor?.selectionStart,
        selectionEnd: editor?.selectionEnd,
        previewSource: expected.visual ? form?.previewController?.pendingProjection?.source || null : null,
        activeMathText: expected.visual ? activeMath?.textContent || null : null,
        visualOffset: expected.visual ? selection?.focusOffset ?? null : null
      }
    }, { visual, expectedSource, expectedCaret })).toEqual({
      value: expectedSource,
      selectionStart: expectedCaret,
      selectionEnd: expectedCaret,
      previewSource: visual ? expectedSource : null,
      activeMathText: visual ? "$$\n\n$$" : null,
      visualOffset: visual ? 3 : null
    })
  }

  async assertModeSwitchRespectsNewCaret() {
    const result = await this.page.locator(".source-field").evaluate(async field => {
      const editor = field.editorController
      editor.setEditingMode("visual")
      await new Promise(resolve => requestAnimationFrame(resolve))
      editor.sourceButtonTarget.focus()
      editor.setEditingMode("source")
      await new Promise(resolve => requestAnimationFrame(resolve))
      const current = editor.selectionStart
      // CodeMirror offsets count CRLF as one line break, like `value` does.
      const length = editor.value.length
      const intended = current === length ? Math.max(0, length - 1) : length
      editor.setSelectionRange(intended)
      await new Promise(resolve => requestAnimationFrame(resolve))
      return { intended, actual: editor.selectionStart }
    })
    expect(result.actual).toBe(result.intended)
  }

  async waitForSource(source) {
    await expect.poll(async () => normalizeLineEndings(await this.readSource()))
      .toBe(normalizeLineEndings(source))
  }

  async undo() {
    await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z")
  }

  async redo() {
    await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z")
  }

  async waitForSaved(source) {
    if (source !== undefined) await this.waitForSource(source)
    try {
      await expect(this.page.locator('[data-autosave-target="status"]')).toHaveText("Saved")
    } catch (error) {
      const diagnostic = await this.page.evaluate(() => {
        const form = document.querySelector('form[data-controller~="autosave"]')
        const controller = form && window.Stimulus?.getControllerForElementAndIdentifier(form, "autosave")
        return {
          status: form?.querySelector('[data-autosave-target="status"]')?.textContent || "<missing>",
          timeoutValue: controller?.timeoutValue ?? null,
          recoveryTimeoutValue: controller?.recoveryTimeoutValue ?? null,
          requestActive: Boolean(controller?.requestController),
          requestAborted: controller?.requestController?.signal.aborted ?? null,
          timeoutScheduled: Boolean(controller?.requestTimeout),
          flowSaving: controller?.flow?.saving ?? null,
          flowDirty: controller?.flow?.dirty ?? null,
          flowBlocked: controller?.flow?.blocked ?? null,
          lastSaveErrorCode: controller?.lastSaveError?.code || null
        }
      })
      throw new Error(`${error.message}; autosave diagnostic: ${JSON.stringify(diagnostic)}`)
    }
    if (source !== undefined) await this.assertPersistedSource(source)
  }

  async showVisualMode() {
    await this.page.locator('[data-editor-target="visualButton"]').click()
    await expect(this.page.locator(".visual-editor-form")).toHaveAttribute("data-editor-mode", "visual")
  }

  async assertDocumentLinkPreview(title) {
    const link = this.page.locator(".editor-projection a.document-link").filter({ hasText: title }).last()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute("href", new RegExp(`/documents/${process.env.ELEF_E2E_LINKED_DOCUMENT_ID}$`))
  }

  async refreshPreview() {
    const rendered = await this.page.locator(".visual-editor-form").evaluate(form => form.previewController?.refresh())
    expect(rendered).toBe(true)
  }

  async showSourceMode() {
    await this.page.locator('[data-editor-target="sourceButton"]').click()
    await expect(this.page.locator(".visual-editor-form")).toHaveAttribute("data-editor-mode", "source")
  }

  async assertDocumentPageAspectRatio() {
    const originalViewport = this.page.viewportSize()
    const surface = this.page.locator(".visual-editor-form .document-surface").first()
    try {
      for (const mode of ["visual", "source"]) {
        if (mode === "visual") await this.showVisualMode()
        else await this.showSourceMode()
        await expect.poll(() => surface.getAttribute("data-document-pages-settled")).toBe("true")

        const frameWidths = []
        for (const viewport of [{ width: 1280, height: 840 }, { width: 600, height: 500 }]) {
          await this.page.setViewportSize(viewport)
          await this.page.evaluate(() => new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          }))
          await expect.poll(() => surface.getAttribute("data-document-pages-settled")).toBe("true")
          const frame = this.page.locator(".document-page-frame").first()
          await expect(frame).toBeVisible()
          let metrics
          await expect.poll(async () => {
            metrics = await frame.evaluate(element => {
              const rect = element.getBoundingClientRect()
              const preview = element.closest(".preview-pane")
              return {
                width: rect.width,
                height: rect.height,
                ratio: rect.width / rect.height,
                fitsPreviewWidth: !preview || rect.width <= preview.clientWidth + 1
              }
            })
            return metrics.width > 0 && metrics.height > 0 && Number.isFinite(metrics.ratio)
              && Math.abs(metrics.ratio - 210 / 297) < 0.005 && metrics.fitsPreviewWidth
          }).toBe(true)
          expect(Math.abs(metrics.ratio - 210 / 297)).toBeLessThan(0.005)
          expect(metrics.fitsPreviewWidth).toBe(true)
          if (frameWidths.length) expect(metrics.width).toBeLessThan(frameWidths[0] - 1)
          frameWidths.push(metrics.width)
        }
        expect(frameWidths[1]).toBeLessThan(frameWidths[0] - 1)
      }
    } finally {
      if (originalViewport) await this.page.setViewportSize(originalViewport)
    }
  }

  async assertSourceEditorUsable() {
    const metrics = await this.page.locator(".source-field").evaluate(field => {
      const controller = field.editorController
      const editor = field.querySelector(".cm-editor")
      const content = field.querySelector(".cm-content")
      const scroller = field.querySelector(".cm-scroller")
      const form = field.closest("form")
      const projection = form?.querySelector(".editor-projection")
      const rect = editor?.getBoundingClientRect()
      const style = content ? getComputedStyle(content) : null
      return {
        ready: Boolean(controller?.editorReady && controller.view?.state?.doc),
        mode: field.closest("form")?.dataset.editorMode,
        width: rect?.width || 0,
        height: rect?.height || 0,
        fontFamily: style?.fontFamily || "",
        color: style?.color || "",
        scrollerDisplay: scroller ? getComputedStyle(scroller).display : "",
        contentWhiteSpace: style?.whiteSpace || "",
        lineHeight: scroller ? parseFloat(getComputedStyle(scroller).lineHeight) || 0 : 0,
        previewVisible: projection ? getComputedStyle(projection).display !== "none" : false
      }
    })
    if (!metrics.ready || metrics.mode !== "source" || metrics.width < 280 || metrics.height < 300
      || !metrics.fontFamily.toLowerCase().includes("monospace") || metrics.color === "rgba(0, 0, 0, 0)"
      || metrics.scrollerDisplay !== "flex" || metrics.contentWhiteSpace !== "pre"
      || metrics.lineHeight <= 0 || !metrics.previewVisible) {
      throw new Error(`The source editor layout or CodeMirror state is unusable: ${JSON.stringify(metrics)}`)
    }
  }

  async waitForAuthoringOption(palette, name) {
    const label = palette === "snippet"
      ? "Snippet suggestions"
      : palette === "document-link" ? "Document link suggestions" : "Math shortcut suggestions"
    const option = this.page.locator(`.source-field [role="listbox"][aria-label="${label}"] [role="option"]`).filter({ hasText: name }).first()
    await expect(option).toBeVisible()
  }

  async selectAuthoringOption(palette, name) {
    const label = palette === "snippet"
      ? "Snippet suggestions"
      : palette === "document-link" ? "Document link suggestions" : "Math shortcut suggestions"
    const option = this.page.locator(`.source-field [role="listbox"][aria-label="${label}"] [role="option"]`).filter({ hasText: name }).first()
    await option.click()
  }

  async refreshDocumentLinkPalette() {
    await this.page.locator(".source-field").evaluate(field => {
      const controller = globalThis.Stimulus?.getControllerForElementAndIdentifier(field, "document-link-palette")
      if (!controller) throw new Error("The document-link palette controller is unavailable")
      controller.refresh()
    })
  }

  async editVisualText(currentText, replacementText) {
    const edited = await this.page.evaluate(({ currentText, replacementText }) => {
      const block = [...document.querySelectorAll(".editor-projection .slide-block")]
        .find(candidate => candidate.textContent.trim() === currentText)
      if (!block || block.getAttribute("contenteditable") !== "true") return false
      block.focus()
      block.textContent = replacementText
      return block.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: replacementText
      }))
    }, { currentText, replacementText })
    expect(edited).toBe(true)
  }

  async insertImage({ bytes, filename, mimeType }) {
    await this.page.locator(".source-field").evaluate(field => {
      const editor = field.editorController
      editor.setSelectionRange(editor.sourceValue.length)
    })
    await this.page.locator('input[data-media-target="input"]').setInputFiles({
      name: filename,
      mimeType,
      buffer: bytes
    })
    await expect.poll(() => this.readSource()).toContain(PIXEL_PNG_MARKDOWN)
    return this.readSource()
  }

  async waitForImage(digest) {
    await expect.poll(() => this.page.locator('img[data-editor-image-source="true"]').evaluateAll((images, expectedDigest) =>
      images.some(image => image.src.includes(expectedDigest) && image.complete && image.naturalWidth > 0), digest
    )).toBe(true)
  }

  async waitForPreview(text) {
    await expect.poll(() => renderedTextWithoutEditorControls(
      this.page.locator(".editor-projection.preview-pane")
    )).toContain(text)
  }

  async inspectHostilePreview() {
    return this.page.locator(".editor-projection.preview-pane").evaluate(preview => {
      const elements = [...preview.querySelectorAll("*")]
      const links = [...preview.querySelectorAll("a[href]")]
      const media = [...preview.querySelectorAll("img[src], video[src]")]
      return {
        scriptRan: window.__elefHostileScriptRan === true,
        eventRan: window.__elefHostileEventRan === true,
        frameRan: window.__elefHostileFrameRan === true,
        inlineHandlers: elements.flatMap(element => [...element.attributes]).filter(attribute => /^on/i.test(attribute.name)).map(attribute => attribute.name),
        executableElements: elements.filter(element => ["SCRIPT", "IFRAME", "OBJECT", "EMBED", "SVG"].includes(element.tagName)).map(element => element.tagName),
        unsafeLinks: links.map(link => link.getAttribute("href")).filter(href => /^(?:javascript|data|vbscript):/i.test(href || "")),
        unsafeMedia: media.map(element => element.getAttribute("src")).filter(src => /^(?:data:|javascript:)/i.test(src || "")),
        externalMedia: media.map(element => element.getAttribute("src")).filter(src => /^https?:/i.test(src || "")),
        remoteRequests: performance.getEntriesByType("resource").filter(entry => entry.name.startsWith("https://example.invalid/")).map(entry => entry.name)
      }
    })
  }

  async writeExternalSource(source) {
    const code = `Presentation.find(${Number(process.env.ELEF_E2E_CONFLICT_PRESENTATION_ID)}).update!(source: ${JSON.stringify(source)})`
    execFileSync("bin/rails", ["runner", "-e", "test", code], {
      cwd: path.resolve(process.cwd(), "../.."),
      env: { ...process.env, RAILS_ENV: "test" },
      stdio: "pipe"
    })
  }

  async pauseAutosave() {
    const paused = await this.page.evaluate(() => {
      const form = document.querySelector('form[data-controller~="autosave"]')
      const controller = form && Stimulus.getControllerForElementAndIdentifier(form, "autosave")
      if (!controller) return false
      controller.flow?.pause()
      return true
    })
    expect(paused).toBe(true)
  }

  async flushLocalSave() {
    const started = await this.page.evaluate(async () => {
      const form = document.querySelector('form[data-controller~="autosave"]')
      const controller = form && Stimulus.getControllerForElementAndIdentifier(form, "autosave")
      if (!controller) return false
      await controller.save()
      return true
    })
    expect(started).toBe(true)
  }

  async waitForConflict() {
    await expect(this.page.locator("#conflict-dialog")).toBeVisible()
  }

  async assertConflict(localSource, externalSource) {
    await expect.poll(() => this.readSource()).toBe(localSource)
    await expect(this.page.locator("#conflict-local")).toHaveText(localSource)
    await expect(this.page.locator("#conflict-disk")).toHaveText(externalSource)
  }

  async useDiskVersion() {
    await this.page.locator("#use-disk-version").click()
    await expect(this.page.locator("#conflict-dialog")).toBeHidden()
    await expect(this.page.locator('[data-autosave-target="status"]')).toHaveText("Saved")
  }

  async keepLocalVersion() {
    await this.page.locator("#keep-local-version").click()
    await expect(this.page.locator("#conflict-dialog")).toBeHidden()
    await this.flushLocalSave()
  }

  async editMergedSource(source) {
    await this.page.locator("#conflict-merge").fill(source)
  }

  async saveMergedVersion() {
    await this.page.locator("#save-merged-version").click()
    await expect(this.page.locator("#conflict-dialog")).toBeHidden()
  }

  async assertDiskSource(source) {
    await expect.poll(() => this.readSource()).toBe(source)
    await this.assertPersistedSource(source, process.env.ELEF_E2E_CONFLICT_PRESENTATION_ID)
  }

  async assertPersistedSource(source, workId = this.activeWorkId || process.env.ELEF_E2E_PRESENTATION_ID) {
    const id = Number(workId)
    const model = String(workId) === String(process.env.ELEF_E2E_DOCUMENT_ID) ? "Document" : "Presentation"
    const serialized = execFileSync("bin/rails", [
      "runner", "-e", "test",
      `puts "ELEF_E2E_PERSISTED_SOURCE=#{${model}.find(${id}).source.to_json}"`
    ], {
      cwd: path.resolve(process.cwd(), "../.."),
      env: { ...process.env, RAILS_ENV: "test" },
      encoding: "utf8"
    }).match(/^ELEF_E2E_PERSISTED_SOURCE=(.*)$/m)?.[1]
    expect(serialized).toBeTruthy()
    expect(normalizeLineEndings(JSON.parse(serialized))).toBe(normalizeLineEndings(source))
  }
}

class WebLibraryUi {
  constructor(page) {
    this.page = page
  }

  async openLibrary() {
    if (new URL(this.page.url()).pathname === "/") return
    const exitLink = this.page.getByRole("link", { name: "Exit", exact: true })
    if (await exitLink.count()) {
      await exitLink.click()
      await expect(this.page.getByText("Saved preview", { exact: true })).toBeVisible()
    }
    const libraryLink = this.page.getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library", exact: true })
    if (await libraryLink.count()) await libraryLink.click()
    else await this.page.goto("/", { waitUntil: "domcontentloaded" })
    await expect(this.page.locator("#deck-list")).toBeVisible()
  }

  async createWork(title, kind) {
    if (!["presentation", "document"].includes(kind)) throw new Error(`Unsupported shared library fixture kind: ${kind}`)
    await this.page.locator(".new-work-trigger").click()
    const menuItem = this.page.getByRole("menuitem", { name: kind === "document" ? /Document/ : /Presentation/ })
    await expect(menuItem).toBeVisible()
    const destination = kind === "document" ? "/documents/new" : "/presentations/new"
    await menuItem.evaluate(link => link.click())
    await expect(this.page).toHaveURL(new RegExp(`${destination.replaceAll("/", "\\/")}$`))
    await expect(this.page.locator(".visual-editor-form")).toBeVisible()
    if (kind === "presentation") {
      await this.page.locator(".editor-title-input").fill(title)
    } else {
      await this.page.locator('[data-editor-target="sourceButton"]').click()
      await expect(this.page.locator(".visual-editor-form")).toHaveAttribute("data-editor-mode", "source")
      const editor = this.page.locator(".source-field .cm-content")
      await editor.click()
      await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
      await this.page.keyboard.insertText(`# ${title}\n\n`)
      await expect.poll(() => this.page.locator(".source-field")
        .evaluate(field => field.editorController?.sourceValue ?? "")).toBe(`# ${title}\n\n`)
    }
    await this.page.locator(".visual-editor-form button[type='submit']").click()
    await expect(this.page).toHaveURL(kind === "document" ? /\/documents\/\d+\/edit/ : /\/presentations\/\d+\/edit/)
    if (kind === "presentation") await expect(this.page.locator(".editor-title-input")).toHaveValue(title)
    else await expect.poll(() => this.page.locator(".source-field")
      .evaluate(field => field.editorController?.sourceValue ?? "")).toBe(`# ${title}\n\n`)
  }

  async assertCreatedWork(title, kind) {
    await expect(this.page.locator(".visual-editor-form")).toBeVisible()
    if (kind === "document") {
      await expect.poll(() => this.page.locator(".source-field")
        .evaluate(field => field.editorController?.sourceValue ?? "")).toBe(`# ${title}\n\n`)
    } else {
      await expect(this.page.locator(".editor-title-input")).toHaveValue(title)
    }
  }

  async assertWorkVisible(title) {
    await expect(this.page.getByRole("heading", { name: title, exact: true })).toBeVisible()
  }

  async openCardAction(card, actionName) {
    const menu = card.locator(".library-card-menu")
    await menu.locator(".library-card-menu-trigger").click()
    await expect(menu).toHaveAttribute("open", "")
    const action = card.getByRole("button", { name: actionName, exact: true })
    await expect(action).toBeVisible()
    return action
  }

  async deleteWork(title) {
    const card = this.page.locator("article.library-card").filter({
      has: this.page.getByRole("heading", { name: title, exact: true })
    })
    this.page.once("dialog", dialog => dialog.accept())
    const action = await this.openCardAction(card, "Delete")
    await action.evaluate(button => button.click())
    await expect(this.page.getByRole("heading", { name: title, exact: true })).toHaveCount(0)
  }

  async assertWorkAbsent(title) {
    await this.openLibrary()
    await expect(this.page.getByRole("heading", { name: title, exact: true })).toHaveCount(0)
  }

  async previewWork(title) {
    const card = this.page.locator("article.library-card").filter({
      has: this.page.getByRole("heading", { name: title, exact: true })
    })
    await card.locator(".library-card-preview-button").click()
    await expect(this.page.getByText("Saved preview", { exact: true })).toBeVisible()
    await expect(this.page.getByRole("heading", { name: title, exact: true })).toBeVisible()
    await this.page.getByRole("link", { name: "Edit", exact: true }).click()
    await expect(this.page.locator(".visual-editor-form")).toBeVisible()
    await this.openLibrary()
  }

  async presentWork(title) {
    const card = this.page.locator("article.library-card").filter({
      has: this.page.getByRole("heading", { name: title, exact: true })
    })
    const action = await this.openCardAction(card, "Present")
    await action.evaluate(button => button.click())
    await expect(this.page.locator(".presentation-stage")).toBeVisible()
    await this.page.getByRole("link", { name: "Exit", exact: true }).click()
    await expect(this.page.getByText("Saved preview", { exact: true })).toBeVisible()
    await this.page.getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library", exact: true }).click()
    await expect(this.page.getByRole("heading", { name: title, exact: true })).toBeVisible()
  }

  async openWork(title) {
    const card = this.page.locator("article.library-card").filter({
      has: this.page.getByRole("heading", { name: title, exact: true })
    })
    await card.locator(".library-card-title a").click()
    await expect(this.page.locator(".visual-editor-form")).toBeVisible()
  }

  async showSourceMode() {
    await this.page.locator('[data-editor-target="sourceButton"]').click()
    await expect(this.page.locator(".visual-editor-form")).toHaveAttribute("data-editor-mode", "source")
  }

  async assertVisualMode() {
    await expect(this.page.locator(".visual-editor-form")).toHaveAttribute("data-editor-mode", "visual")
  }

  async assertAllWorkKindsVisible(presentationTitle, documentTitle) {
    await expect(this.page.getByRole("heading", { name: presentationTitle, exact: true })).toBeVisible()
    await expect(this.page.getByRole("heading", { name: documentTitle, exact: true })).toBeVisible()
    await expect(this.page.locator("article.library-card")).toHaveCount(5)
  }

  async renameWork(title, newTitle) {
    const card = this.page.locator("article.library-card").filter({
      has: this.page.getByRole("heading", { name: title, exact: true })
    })
    await card.locator(".library-card-menu-trigger").click()
    await card.locator(".rename-menu > summary").click()
    await card.locator(".library-rename input[type='text']").fill(newTitle)
    await card.getByRole("button", { name: "Save title", exact: true }).click()
    await expect(this.page.getByRole("heading", { name: newTitle, exact: true })).toBeVisible()
  }

  async assertCardPreview(title, text) {
    const card = this.page.locator("article.library-card").filter({
      has: this.page.getByRole("heading", { name: title, exact: true })
    })
    await expect.poll(() => renderedTextWithoutEditorControls(
      card.locator(".library-card-preview")
    )).toContain(text)
  }

  async assertDocumentCardTheme(title, theme) {
    const card = this.page.locator("article.library-card").filter({
      has: this.page.getByRole("heading", { name: title, exact: true })
    })
    const surface = card.locator(".library-card-preview .document-surface")
    await expect.poll(() => surface.getAttribute("data-document-pages-settled")).toBe("true")
    const frame = card.locator(".library-card-preview .document-page-frame").first()
    await expect(frame).toBeVisible()
    const page = card.locator(".library-card-preview .document-page").first()
    const style = await page.evaluate((element, expectedTheme) => {
      const rect = element.closest(".document-page-frame").getBoundingClientRect()
      return {
        hasTheme: Boolean(element.closest(`.document-reader.document-theme-${expectedTheme}`)),
        background: getComputedStyle(element).backgroundImage,
        backgroundColor: getComputedStyle(element).backgroundColor,
        frame: { width: rect.width, height: rect.height }
      }
    }, theme)
    expect(style.hasTheme).toBe(true)
    if (theme === "dark") expect(style.background).toContain("linear-gradient")
    else {
      expect(style.background).toBe("none")
      expect(style.backgroundColor).toBe("rgb(255, 253, 248)")
    }
    expect(Math.abs(style.frame.width / style.frame.height - 210 / 297)).toBeLessThan(0.005)
  }

  async searchFor(query) {
    await this.page.locator("#library-search").fill(query)
  }

  async assertSearchResults(title) {
    await expect(this.page.locator("article.library-card:visible")).toHaveCount(1)
    await expect(this.page.getByRole("heading", { name: title, exact: true })).toBeVisible()
  }

  async assertNoSearchResults() {
    await expect(this.page.locator("article.library-card:visible")).toHaveCount(0)
    await expect(this.page.getByRole("status").filter({ hasText: "No decks match this search." })).toBeVisible()
  }

  async showPresentations() {
    await this.page.getByRole("link", { name: "Presentations", exact: true }).click()
  }

  async assertPresentationsOnly(presentationTitle, documentTitle) {
    await expect(this.page.getByRole("heading", { name: presentationTitle, exact: true })).toBeVisible()
    await expect(this.page.getByRole("heading", { name: documentTitle, exact: true })).toHaveCount(0)
    await expect(this.page.locator("article.library-card")).toHaveCount(3)
  }

  async showDocuments() {
    await this.page.goto("/documents")
  }

  async assertDocumentsOnly(documentTitle) {
    await expect(this.page.getByRole("heading", { name: documentTitle, exact: true })).toBeVisible()
    await expect(this.page.locator("article.library-card")).toHaveCount(2)
  }

  async showDocumentGraph() {
    await expect(this.page.locator("#document-graph-heading")).toBeVisible()
  }

  async assertGraphDocumentsVisible(count, linkedTitle) {
    await expect(this.page.locator(".document-graph-node")).toHaveCount(count)
    await expect(this.page.getByRole("link", { name: `Open ${linkedTitle}` })).toBeVisible()
  }

  async openGraphDocument(title) {
    await this.page.getByRole("link", { name: `Open ${title}` }).click()
  }

  async assertDocumentOpened(title) {
    const content = this.page.locator(".document-reader .document-surface")
    await expect(content.getByRole("heading", { name: title, exact: true })).toBeVisible()
  }
}

test("shared editing flow works in the web app", async ({ page }) => {
  await editAndPreviewWorkflow(new WebEditorUi(page))
  await expect(page.locator(".source-field .cm-content")).toContainText("Saved by shared scenario")
  await expect.poll(() => page.locator(".source-field").evaluate(field => field.editorController.sourceValue)).toContain(PIXEL_PNG_MARKDOWN)
  expect(await page.locator(".source-field .cm-content").innerText()).toContain(SAVED_SOURCE.split("\n")[0])
})

test("shared presentation navigation works in the web app", async ({ page }) => {
  await presentationModeWorkflow(new WebEditorUi(page))
})

test("Vim relative line numbers update from CodeMirror cursor positions", async ({ page }) => {
  await vimRelativeLineNumbersWorkflow(new WebEditorUi(page))
})

test("document pages keep their A4 aspect ratio when the web editor is resized", async ({ page }) => {
  await documentPageAspectRatioWorkflow(new WebEditorUi(page))
})

test("shared library and document graph flow works in the web app", async ({ page }) => {
  await libraryAndGraphWorkflow(new WebLibraryUi(page))
})

test("shared library create and delete flow works in the web app", async ({ page }) => {
  await libraryCreateDeleteWorkflow(new WebLibraryUi(page))
})

test("shared external-edit conflict flow preserves the disk version in the web app", async ({ page }) => {
  const ui = new WebEditorUi(page)
  await externalEditConflictWorkflow(ui)
  expect(await ui.readSource()).toBe(CONFLICT_EXTERNAL_SOURCE)
})

test("shared external-edit conflict flow keeps the local version in the web app", async ({ page }) => {
  await externalEditConflictWorkflow(new WebEditorUi(page), "local")
})

test("shared external-edit conflict flow saves a merge in the web app", async ({ page }) => {
  await externalEditConflictWorkflow(new WebEditorUi(page), "merge")
})

test("shared snippet insertion flow works in the web app", async ({ page }) => {
  await snippetInsertWorkflow(new WebEditorUi(page))
})

test("shared document-link completion replaces auto-paired closers in the web app", async ({ page }) => {
  await documentLinkCompletionWorkflow(new WebEditorUi(page))
})

test("shared authoring settings create, edit, and delete flow works in the web app", async ({ page }) => {
  await authoringSettingsWorkflow(new WebEditorUi(page))
})

test("shared math input flow works in the web app", async ({ page }) => {
  await mathInputWorkflow(new WebEditorUi(page))
})

test("empty display math keeps its body caret in both web editor modes", async ({ page }) => {
  await displayMathEnterWorkflow(new WebEditorUi(page))
})

test("shared hostile-deck security flow works in the web app", async ({ page }) => {
  await hostileDeckNeutralizedWorkflow(new WebEditorUi(page))
})

test("appearance persists through the shared editing flow", async ({ page }) => {
  await appearanceWorkflow(new WebEditorUi(page))
})

test("shared rendering styles preserve slide layouts and document typography", async ({ page }) => {
  const styles = {
    web: (await readFile(new URL("../../../app/assets/builds/tailwind.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../../app/assets/stylesheets/application.css", import.meta.url), "utf8")),
    desktop: (await readFile(new URL("../../../app/assets/stylesheets/file_library_host.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../frontend/dist/assets/tailwind.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../frontend/dist/assets/app.css", import.meta.url), "utf8"))
  }
  const fixtures = [
    { kind: "presentation", source: "# Roadmap\n\n## First\n\nFirst column.\n\n## Second\n\nSecond column.\n", style: { theme: "light", typography: "book" } },
    { kind: "presentation", source: "# Theme\n\nDark presentation text.\n", style: { theme: "dark", typography: "technical" } },
    { kind: "document", source: "# Document\n\nBody text with **emphasis**.\n", style: { theme: "light", typography: "book" } },
    { kind: "document", source: "# Technical\n\nBody text with `code`.\n", style: { theme: "dark", typography: "technical" } }
  ]
  for (const fixture of fixtures) {
    const html = renderPreview({ ...fixture, title: "Style fixture", allowRemoteMedia: false }).html
    const measured = {}
    for (const [target, css] of Object.entries(styles)) {
      await page.setContent(`<style>${css}\n*{box-sizing:border-box}body{margin:0}.fixture-root{width:1280px}</style><div class="fixture-root">${html}</div>`)
      measured[target] = await page.evaluate(() => {
        const selectors = [".slide", ".slide h1", ".slide p", ".slide-regions", ".document-surface", ".document-surface h1", ".document-surface p"]
        return Object.fromEntries(selectors.flatMap(selector => {
          const node = document.querySelector(selector)
          if (!node) return []
          const style = getComputedStyle(node)
          return [[selector, { font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight,
            color: style.color, background: style.backgroundImage, display: style.display,
            columns: style.gridTemplateColumns, width: style.width }]]
        }))
      })
    }
    expect(measured.desktop).toEqual(measured.web)
    if (fixture.source.includes("## Second")) {
      expect(measured.desktop[".slide-regions"].display).toBe("grid")
      expect(measured.desktop[".slide-regions"].columns.split(" ")).toHaveLength(2)
    }
  }
})

test("the source editor has matching styles in Rails and the desktop asset bundle", async ({ page }) => {
  const presentationId = process.env.ELEF_E2E_PRESENTATION_ID
  if (!presentationId) throw new Error("The source-editor parity check requires the E2E presentation fixture")
  await page.setViewportSize({ width: 1280, height: 840 })
  await page.goto(`/presentations/${presentationId}/edit?editor_mode=source`)
  await expect(page.locator(".visual-editor-form")).toHaveAttribute("data-editor-mode", "source")
  await expect(page.locator(".source-field .cm-content")).toBeVisible()

  const editorHtml = await page.locator(".editor-shell").evaluate(element => element.outerHTML)
  const codeMirrorStyles = await page.locator("head style").evaluateAll(styles => styles.map(style => style.textContent).join("\n"))
  const stylesheets = {
    web: (await readFile(new URL("../../../app/assets/builds/tailwind.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../../app/assets/stylesheets/application.css", import.meta.url), "utf8")),
    desktop: (await readFile(new URL("../../../app/assets/stylesheets/file_library_host.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../frontend/dist/assets/tailwind.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../frontend/dist/assets/app.css", import.meta.url), "utf8"))
  }
  const measured = {}
  for (const [target, css] of Object.entries(stylesheets)) {
    await page.setContent(`<!doctype html><html data-theme="dark"><head><style>${css}</style><style>${codeMirrorStyles}</style></head><body class="elef-app"><main class="app-shell mx-auto max-w-[1440px] p-[clamp(1rem,4vw,3rem)]"><form class="visual-editor-form" data-editor-mode="source">${editorHtml}</form></main></body></html>`)
    measured[target] = await page.evaluate(() => {
      const selectors = [".editor-shell", ".editor-layout", ".source-pane", ".source-field", ".editor-toolbar",
        ".editor-surface", ".cm-editor", ".cm-scroller", ".cm-content", ".editor-projection"]
      const properties = ["display", "position", "width", "height", "minHeight", "maxHeight", "gridTemplateColumns",
        "gap", "fontFamily", "fontSize", "lineHeight", "color", "backgroundColor", "overflow", "padding", "borderRadius"]
      return Object.fromEntries(selectors.flatMap(selector => {
        const element = document.querySelector(selector)
        if (!element) return []
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return [[selector, {
          ...Object.fromEntries(properties.map(property => [property, style[property]])),
          rectWidth: rect.width,
          rectHeight: rect.height
        }]]
      }))
    })
  }
  expect(measured.desktop).toEqual(measured.web)
  expect(measured.web[".editor-layout"].gridTemplateColumns.split(" ")).toHaveLength(2)
  expect(measured.web[".cm-editor"].rectHeight).toBeGreaterThan(300)
})
