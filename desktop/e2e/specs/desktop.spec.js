import { $, $$, browser } from "@wdio/globals"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { editAndPreviewWorkflow } from "../scenarios/edit-and-preview.js"
import { libraryAndGraphWorkflow } from "../scenarios/library-and-graph.js"

class DesktopEditorUi {
  async openDeck() {
    if (!(await $("#library-view").isDisplayed())) {
      await $("#back-to-library").click()
      await $("#library-view").waitForDisplayed()
    }
    await $("#show-deck-list").click()
    const card = $('[aria-label="Open E2E seed"]')
    await card.waitForDisplayed()
    await card.click()
    await browser.waitUntil(async () => (await $("#deck-title").getText()) === "E2E seed", {
      timeout: 10_000,
      timeoutMsg: "The E2E seed deck did not open"
    })
  }

  async replaceSource(source) {
    const sourceMode = await $("#source-mode")
    await sourceMode.waitForDisplayed()
    if ((await sourceMode.getAttribute("aria-pressed")) !== "true") await sourceMode.click()
    const editor = await $("#deck-source-editor .cm-content")
    await editor.waitForDisplayed()
    await editor.click()
    const selectAll = process.platform === "darwin" ? "\uE03Da" : "\uE009a"
    await editor.addValue(selectAll)
    const lines = source.split("\n")
    for (const [index, line] of lines.entries()) {
      if (line) await editor.addValue(line)
      if (index < lines.length - 1) await editor.addValue("\uE007")
    }
  }

  async waitForSaved(expectedSource) {
    if (expectedSource !== undefined) {
      try {
        await browser.waitUntil(async () => {
          const editorSource = await browser.execute(() => document.querySelector("#desktop-editor-field")?.editorController?.sourceValue ?? null)
          return editorSource === expectedSource
        }, {
          timeout: 10_000,
          timeoutMsg: "The desktop editor buffer did not contain the text entered by the shared scenario"
        })
      } catch (error) {
        const state = await browser.execute(() => ({
          sourceValue: document.querySelector("#desktop-editor-field")?.editorController?.sourceValue ?? null,
          textareaValue: document.querySelector("#deck-source")?.value ?? null,
          editorText: document.querySelector("#deck-source-editor .cm-content")?.innerText ?? null
        }))
        throw new Error(`${error.message}; editor state: ${JSON.stringify(state)}`)
      }
      const sourcePath = path.join(process.env.ELEF_E2E_LIBRARY_ROOT, "E2E seed", "presentation.md")
      await browser.waitUntil(async () => {
        try {
          return await readFile(sourcePath, "utf8") === expectedSource
        } catch (_error) {
          return false
        }
      }, {
        timeout: 10_000,
        timeoutMsg: "The desktop editor reported Saved before the source file held the expected text"
      })
    }
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
    try {
      await browser.waitUntil(async () => (await $("#desktop-preview").getText()).includes(text), {
        timeout: 10_000,
        timeoutMsg: "The desktop preview did not render the saved text"
      })
    } catch (error) {
      const state = await browser.execute(() => {
        const form = document.querySelector("#desktop-editor-form")
        const field = document.querySelector("#desktop-editor-field")
        return {
          mode: form?.dataset.editorMode,
          source: field?.editorController?.sourceValue,
          saveState: document.querySelector("#save-state")?.textContent,
          previewStatus: document.querySelector("[data-preview-target='status']")?.textContent,
          preview: document.querySelector("#desktop-preview")?.innerText,
          warnings: document.querySelector("[data-preview-target='warnings']")?.innerText,
          stale: form?.dataset.previewProjectionStale || null
        }
      })
      throw new Error(`${error.message}; desktop state: ${JSON.stringify(state)}`)
    }
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
    await $("#library-view").waitForDisplayed()
    await browser.execute(() => window.focus())
    if (process.platform === "darwin") {
      execFileSync("osascript", ["-e", 'tell application "System Events" to keystroke "n" using {command down}'], { timeout: 5_000 })
    } else if (process.platform === "linux") {
      execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+n"], { timeout: 5_000 })
    } else {
      throw new Error(`Native menu smoke is unsupported on ${process.platform}`)
    }
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
