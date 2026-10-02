import { expect, test } from "@playwright/test"
import { editAndPreviewWorkflow, SAVED_SOURCE } from "../scenarios/edit-and-preview.js"
import { libraryAndGraphWorkflow } from "../scenarios/library-and-graph.js"
import { externalEditConflictWorkflow, CONFLICT_EXTERNAL_SOURCE } from "../scenarios/external-edit-conflict.js"
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
  }

  async openDeck(title = "E2E seed") {
    const id = title === "E2E conflict"
      ? process.env.ELEF_E2E_CONFLICT_PRESENTATION_ID
      : process.env.ELEF_E2E_PRESENTATION_ID
    if (!id) throw new Error("The shared web scenario requires an E2E presentation fixture")
    await this.page.goto(`/presentations/${id}/edit?editor_mode=source`)
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

  async waitForAuthoringOption(palette, name) {
    const option = this.page.locator(`#deck-source-${palette}-palette [role="option"]`).filter({ hasText: name }).first()
    await expect(option).toBeVisible()
  }

  async selectAuthoringOption(palette, name) {
    const option = this.page.locator(`#deck-source-${palette}-palette [role="option"]`).filter({ hasText: name }).first()
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
    await expect(this.page.locator(".editor-projection.preview-pane")).toContainText(text)
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

  async assertPersistedSource(source, presentationId = process.env.ELEF_E2E_PRESENTATION_ID) {
    const id = Number(presentationId)
    const serialized = execFileSync("bin/rails", [
      "runner", "-e", "test",
      `puts "ELEF_E2E_PERSISTED_SOURCE=#{Presentation.find(${id}).source.to_json}"`
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
