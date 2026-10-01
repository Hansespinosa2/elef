import { $, $$, browser } from "@wdio/globals"
import { editAndPreviewWorkflow } from "../scenarios/edit-and-preview.js"
import { libraryAndGraphWorkflow } from "../scenarios/library-and-graph.js"

class DesktopEditorUi {
  async openDeck() {
    const card = $('[aria-label="Open E2E seed"]')
    await card.waitForDisplayed()
    await card.click()
    await browser.waitUntil(async () => (await $("#deck-title").getText()) === "E2E seed", {
      timeout: 10_000,
      timeoutMsg: "The E2E seed deck did not open"
    })
  }

  async replaceSource(source) {
    const editor = await $("#deck-source-editor .cm-content")
    await editor.waitForDisplayed()
    await editor.click()
    await browser.keys(process.platform === "darwin" ? ["Meta", "a"] : ["Control", "a"])
    await browser.keys(source)
  }

  async waitForSaved() {
    await browser.waitUntil(async () => (await $("#save-state").getText()) === "Saved", {
      timeout: 10_000,
      timeoutMsg: "The desktop editor did not finish saving"
    })
  }

  async showVisualMode() {
    const visualButton = await $("#visual-mode")
    await visualButton.waitForEnabled()
    await visualButton.click()
  }

  async waitForPreview(text) {
    await browser.waitUntil(async () => (await $("#desktop-preview").getText()).includes(text), {
      timeout: 10_000,
      timeoutMsg: "The desktop preview did not render the saved text"
    })
  }
}

class DesktopLibraryUi {
  async openLibrary() {
    await browser.waitUntil(async () => (await $("#library-view").isDisplayed()), {
      timeout: 10_000,
      timeoutMsg: "The desktop library did not open"
    })
  }

  async showDocuments() {
    await $("#show-documents").click()
  }

  async assertDocumentsOnly(documentTitle) {
    await browser.waitUntil(async () => (await $(`[aria-label='Open ${documentTitle}']`).isDisplayed()), {
      timeout: 10_000,
      timeoutMsg: "The document filter did not show its document"
    })
    if ((await $$(".deck-card")).length !== 2) {
      throw new Error("The document filter did not show the two fixture documents")
    }
    if (await $(`[aria-label='Open E2E seed']`).isExisting()) {
      throw new Error("The document filter still shows a presentation")
    }
  }

  async showDocumentGraph() {
    await $("#show-document-graph").click()
    await $("#document-graph-mount").waitForDisplayed()
  }

  async openGraphDocument(title) {
    await $(`[aria-label='Open ${title}']`).click()
  }

  async assertDocumentOpened(title) {
    await browser.waitUntil(async () => (await $("#deck-title").getText()) === title, {
      timeout: 10_000,
      timeoutMsg: `The graph did not open ${title}`
    })
  }
}

describe("shared authoring scenarios", () => {
  it("opens the new-deck dialog from the native menu accelerator", async () => {
    await browser.keys(process.platform === "darwin" ? ["Meta", "n"] : ["Control", "n"])
    const dialog = await $("#create-dialog")
    await dialog.waitForDisplayed()
    await $("#create-form button[value='cancel']").click()
  })

  it("runs the shared library and document graph flow", async () => {
    await libraryAndGraphWorkflow(new DesktopLibraryUi())
  })

  it("edits, saves, and previews a deck in the desktop binary", async () => {
    await editAndPreviewWorkflow(new DesktopEditorUi())
    const form = await $("#desktop-editor-form")
    if (await form.getAttribute("data-editor-mode") !== "visual") {
      throw new Error("The editor did not switch into visual mode")
    }
  })
})
