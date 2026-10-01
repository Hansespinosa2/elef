import { expect, test } from "@playwright/test"
import { editAndPreviewWorkflow, SAVED_SOURCE } from "../scenarios/edit-and-preview.js"

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

  async waitForSaved() {
    await expect(this.page.locator('[data-autosave-target="status"]')).toHaveText("Saved")
  }

  async showVisualMode() {
    await this.page.locator('[data-editor-target="visualButton"]').click()
  }

  async waitForPreview(text) {
    await expect(this.page.locator(".editor-projection.preview-pane")).toContainText(text)
  }
}

test("shared editing flow works in the web app", async ({ page }) => {
  await editAndPreviewWorkflow(new WebEditorUi(page))
  await expect(page.locator(".source-field .cm-content")).toContainText("Saved by shared scenario")
  expect(await page.locator(".source-field .cm-content").innerText()).toContain(SAVED_SOURCE.split("\n")[0])
})
