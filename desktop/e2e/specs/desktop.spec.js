import assert from "node:assert/strict"
import { test } from "@playwright/test"
import { EmbeddedTauriDriver } from "../support/embedded-tauri-driver.js"
import { editAndPreviewWorkflow } from "../scenarios/edit-and-preview.js"

class DesktopEditorUi {
  constructor(driver) {
    this.driver = driver
  }

  async openDeck() {
    await this.driver.waitForText('[aria-label="Open E2E seed"]', "E2E seed")
    await this.driver.click('[aria-label="Open E2E seed"]')
    await this.driver.waitForText("#deck-title", "E2E seed")
  }

  async replaceSource(source) {
    await this.driver.replaceEditorSource(source)
  }

  async waitForSaved() {
    await this.driver.waitForText("#save-state", "Saved")
  }

  async showVisualMode() {
    await this.driver.waitForEnabled("#visual-mode")
    await this.driver.click("#visual-mode")
  }

  async waitForPreview(text) {
    await this.driver.waitForText("#desktop-preview", text)
  }
}

test("shared editing flow works in the native desktop binary", async () => {
  const driver = new EmbeddedTauriDriver({
    binary: process.env.ELEF_E2E_APP_BINARY,
    libraryRoot: process.env.ELEF_E2E_LIBRARY_ROOT
  })
  await driver.start()
  try {
    await editAndPreviewWorkflow(new DesktopEditorUi(driver))
    assert.equal(await driver.attribute("#desktop-editor-form", "data-editor-mode"), "visual")
  } finally {
    await driver.stop()
  }
})
