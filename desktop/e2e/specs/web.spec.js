import { expect, test } from "@playwright/test"
import { editAndPreviewWorkflow, SAVED_SOURCE } from "../scenarios/edit-and-preview.js"
import { libraryAndGraphWorkflow } from "../scenarios/library-and-graph.js"
import { PIXEL_PNG_MARKDOWN } from "../scenarios/media-fixture.js"

class WebEditorUi {
  constructor(page) {
    this.page = page
  }

  async openDeck() {
    const id = process.env.ELEF_E2E_PRESENTATION_ID
    if (!id) throw new Error("The shared web scenario requires an E2E presentation fixture")
    await this.page.goto(`/presentations/${id}/edit?editor_mode=source`)
    await expect(this.page.locator(".source-field .cm-content")).toBeVisible()
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
    await expect.poll(() => this.readSource()).toBe(source)
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
  }

  async showVisualMode() {
    await this.page.locator('[data-editor-target="visualButton"]').click()
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
    await expect.poll(() => this.page.locator('img[data-editor-image-source="true"]').evaluateAll(images =>
      images.some(image => image.src.includes(digest) && image.complete && image.naturalWidth > 0)
    )).toBe(true)
  }

  async waitForPreview(text) {
    await expect(this.page.locator(".editor-projection.preview-pane")).toContainText(text)
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
