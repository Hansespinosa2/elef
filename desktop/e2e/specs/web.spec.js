import { expect, test } from "@playwright/test"
import { editAndPreviewWorkflow, SAVED_SOURCE } from "../scenarios/edit-and-preview.js"
import { libraryAndGraphWorkflow } from "../scenarios/library-and-graph.js"
import { externalEditConflictWorkflow, CONFLICT_EXTERNAL_SOURCE } from "../scenarios/external-edit-conflict.js"
import { hostileDeckNeutralizedWorkflow } from "../scenarios/hostile-deck.js"
import { mathInputWorkflow, snippetInsertWorkflow } from "../scenarios/authoring-palettes.js"
import { PIXEL_PNG_MARKDOWN } from "../scenarios/media-fixture.js"
import { execFileSync } from "node:child_process"
import path from "node:path"

function normalizeLineEndings(source) {
  return source.replace(/\r\n|\r/g, "\n")
}

class WebEditorUi {
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
    await this.page.goto(`/${path}/${id}/edit?editor_mode=source`)
    await expect(this.page.locator(".source-field .cm-content")).toBeVisible()
  }

  async reopenDeck() {
    await this.openDeck()
  }

  async replaceSource(source) {
    const editor = this.page.locator(".source-field .cm-content")
    await editor.click()
    await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
    await this.page.keyboard.insertText(source)
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

  async assertCaretPosition(position) {
    await expect.poll(() => this.page.locator(".source-field").evaluate(field => [
      field.editorController?.selectionStart,
      field.editorController?.selectionEnd
    ])).toEqual([position, position])
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
    await expect(this.page.locator('[data-autosave-target="status"]')).toHaveText("Saved")
    if (source !== undefined) await this.assertPersistedSource(source)
  }

  async showVisualMode() {
    await this.page.locator('[data-editor-target="visualButton"]').click()
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

  async waitForAuthoringOption(palette, name) {
    const label = palette === "snippet" ? "Snippet suggestions" : "Math shortcut suggestions"
    const option = this.page.locator(`.source-field [role="listbox"][aria-label="${label}"] [role="option"]`).filter({ hasText: name }).first()
    await expect(option).toBeVisible()
  }

  async selectAuthoringOption(palette, name) {
    const label = palette === "snippet" ? "Snippet suggestions" : "Math shortcut suggestions"
    const option = this.page.locator(`.source-field [role="listbox"][aria-label="${label}"] [role="option"]`).filter({ hasText: name }).first()
    await option.click()
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
    const block = this.page.locator(".editor-projection.preview-pane .slide-block").filter({ hasText: text }).first()
    await expect(block).toBeVisible()
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
      controller.clearSaveTimer()
      controller.delayValue = 60_000
      controller.schedule()
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
    await expect(this.page.locator('[data-autosave-target="conflict"]')).toBeVisible()
  }

  async assertConflict(localSource, externalSource) {
    await expect.poll(() => this.readSource()).toBe(localSource)
    await expect.poll(() => this.page.locator('[data-autosave-target="serverSource"]').evaluate(element => element.textContent))
      .toBe(externalSource)
  }

  async useDiskVersion() {
    await this.page.evaluate(() => {
      const form = document.querySelector('form[data-controller~="autosave"]')
      const controller = form && Stimulus.getControllerForElementAndIdentifier(form, "autosave")
      if (!controller) return
      const discardLocal = controller.discardLocal.bind(controller)
      window.__elefDiscardTrace = []
      controller.discardLocal = (...args) => {
        window.__elefDiscardTrace.push({ phase: "entered", hidden: form.querySelector('[data-autosave-target="conflict"]')?.hidden })
        const result = discardLocal(...args)
        window.__elefDiscardTrace.push({
          phase: "returned",
          hidden: form.querySelector('[data-autosave-target="conflict"]')?.hidden,
          hasConflict: Boolean(controller.conflictPayload),
          status: form.querySelector('[data-autosave-target="status"]')?.textContent
        })
        return result
      }
    })
    await this.page.locator('[data-action="click->autosave#discardLocal"]').click()
    try {
      await expect(this.page.locator('[data-autosave-target="conflict"]')).toBeHidden()
    } catch (error) {
      const state = await this.page.evaluate(() => {
        const form = document.querySelector('form[data-controller~="autosave"]')
        const controller = form && Stimulus.getControllerForElementAndIdentifier(form, "autosave")
        const conflict = form?.querySelector('[data-autosave-target="conflict"]')
        return {
          hidden: conflict?.hidden,
          status: form?.querySelector('[data-autosave-target="status"]')?.textContent,
          action: form?.querySelector('[data-action*="discardLocal"]')?.getAttribute("data-action"),
          controllerConnected: Boolean(controller),
          discardTrace: window.__elefDiscardTrace,
          conflictPayload: controller?.conflictPayload ? {
            currentPresent: Boolean(controller.conflictPayload.current),
            currentSource: controller.conflictPayload.current?.source
          } : null
        }
      })
      throw new Error(`${error.message}; discard state: ${JSON.stringify(state)}`)
    }
    await expect(this.page.locator('[data-autosave-target="status"]')).toHaveText("Saved")
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
    await this.page.goto("/")
  }

  async assertAllWorkKindsVisible(presentationTitle, documentTitle) {
    await expect(this.page.getByRole("heading", { name: presentationTitle, exact: true })).toBeVisible()
    await expect(this.page.getByRole("heading", { name: documentTitle, exact: true })).toBeVisible()
    await expect(this.page.locator("article.library-card")).toHaveCount(5)
  }

  async assertCardPreview(title, text) {
    const card = this.page.locator("article.library-card").filter({
      has: this.page.getByRole("heading", { name: title, exact: true })
    })
    await expect(card.locator(".library-card-preview .slide-block").filter({ hasText: text }).first()).toBeVisible()
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

  async openGraphDocument(title) {
    await this.page.getByRole("link", { name: `Open ${title} preview` }).click()
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

test("shared library and document graph flow works in the web app", async ({ page }) => {
  await libraryAndGraphWorkflow(new WebLibraryUi(page))
})

test("shared external-edit conflict flow preserves the disk version in the web app", async ({ page }) => {
  const ui = new WebEditorUi(page)
  await externalEditConflictWorkflow(ui)
  expect(await ui.readSource()).toBe(CONFLICT_EXTERNAL_SOURCE)
})

test("shared snippet insertion flow works in the web app", async ({ page }) => {
  await snippetInsertWorkflow(new WebEditorUi(page))
})

test("shared math input flow works in the web app", async ({ page }) => {
  await mathInputWorkflow(new WebEditorUi(page))
})

test("shared hostile-deck security flow works in the web app", async ({ page }) => {
  await hostileDeckNeutralizedWorkflow(new WebEditorUi(page))
})
