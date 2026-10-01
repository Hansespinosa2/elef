import { $, $$, browser } from "@wdio/globals"
import { execFileSync, spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { editAndPreviewWorkflow } from "../scenarios/edit-and-preview.js"
import { libraryAndGraphWorkflow } from "../scenarios/library-and-graph.js"
import { externalEditConflictWorkflow, CONFLICT_EXTERNAL_SOURCE } from "../scenarios/external-edit-conflict.js"
import { PIXEL_PNG_MARKDOWN } from "../scenarios/media-fixture.js"

function normalizeLineEndings(source) {
  return source.replace(/\r\n/g, "\n")
}

class DesktopEditorUi {
  async pauseAutosave() {}

  async flushLocalSave() {}

  async openDeck(title = "E2E seed") {
    if (!(await $("#library-view").isDisplayed())) {
      await $("#back-to-library").click()
      await $("#library-view").waitForDisplayed()
    }
    await $("#show-deck-list").click()
    const card = $(`[aria-label="Open ${title}"]`)
    await card.waitForDisplayed()
    await card.click()
    await browser.waitUntil(async () => (await $("#deck-title").getText()) === title, {
      timeout: 10_000,
      timeoutMsg: `The ${title} deck did not open`
    })
  }

  async reopenDeck() {
    await this.openDeck()
  }

  async replaceSource(source) {
    const sourceMode = await $("#source-mode")
    await sourceMode.waitForDisplayed()
    if ((await sourceMode.getAttribute("aria-pressed")) !== "true") await sourceMode.click()
    const editor = await $("#deck-source-editor .cm-content")
    await editor.waitForDisplayed()
    // Tauri's embedded WebDriver cannot reliably focus CodeMirror on CI. Use
    // the live controller's input-proxy path so its normal update/input,
    // autosave, preview, and conflict handlers still run.
    const updated = await browser.execute(nextSource => {
      const field = document.querySelector("#desktop-editor-field")
      const controller = field?.editorController
      if (!controller) return false
      controller.replaceRange(nextSource, 0, controller.value.length)
      return controller.sourceValue === nextSource
    }, source)
    if (!updated) throw new Error("The desktop editor did not accept the shared scenario source")
  }

  async readSource() {
    return browser.execute(() => document.querySelector("#desktop-editor-field")?.editorController?.sourceValue ?? "")
  }

  async waitForSource(source) {
    await browser.waitUntil(async () => await this.readSource() === source, {
      timeout: 10_000,
      timeoutMsg: "The desktop editor buffer did not reach the expected source"
    })
  }

  async undo() {
    await this.dispatchHistoryInput("historyUndo")
  }

  async redo() {
    await this.dispatchHistoryInput("historyRedo")
  }

  async dispatchHistoryInput(inputType) {
    await browser.execute(type => {
      const view = document.querySelector("#desktop-editor-field")?.editorController?.view
      if (!view) return false
      return view.contentDOM.dispatchEvent(new InputEvent("beforeinput", {
        inputType: type,
        bubbles: true,
        cancelable: true
      }))
    }, inputType)
  }

  async waitForSaved(expectedSource) {
    if (expectedSource !== undefined) {
      await this.waitForSource(expectedSource)
      const sourcePath = path.join(process.env.ELEF_E2E_LIBRARY_ROOT, "E2E seed", "presentation.md")
      await browser.waitUntil(async () => {
        try {
          return normalizeLineEndings(await readFile(sourcePath, "utf8")) === expectedSource
        } catch (_error) {
          return false
        }
      }, {
        timeout: 10_000,
        timeoutMsg: "The desktop editor reported Saved before the source file held the expected text"
      }).catch(async error => {
        const [diskSource, state] = await Promise.all([
          readFile(sourcePath, "utf8").catch(readError => `<${readError.code || "read_error"}>`),
          browser.execute(() => ({
            saveState: document.querySelector("#save-state")?.textContent || "<missing>",
            status: document.querySelector("#status-text")?.textContent || "<missing>",
            notice: document.querySelector("#notice")?.textContent || "",
            deckId: document.querySelector("#deck-id")?.textContent || "",
            deckTitle: document.querySelector("#deck-title")?.textContent || ""
          }))
        ])
        throw new Error(`${error.message}; desktop state: ${JSON.stringify(state)}; disk source: ${JSON.stringify(diskSource)}`)
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
    await browser.waitUntil(async () => {
      const mode = await $("#desktop-editor-form").getAttribute("data-editor-mode")
      return mode === "visual"
    }, {
      timeout: 5_000,
      timeoutMsg: "The visual-mode control did not activate the visual editor"
    })
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

  async writeExternalSource(source) {
    await writeFile(path.join(process.env.ELEF_E2E_LIBRARY_ROOT, "E2E conflict", "presentation.md"), source)
  }

  async waitForConflict() {
    await $("#conflict-dialog").waitForDisplayed({ timeout: 10_000 })
  }

  async assertConflict(localSource, externalSource) {
    const local = await $("#conflict-local").getText()
    const disk = await $("#conflict-disk").getText()
    if (!local.includes(localSource.trim()) || !disk.includes(externalSource.trim())) {
      throw new Error(`Conflict dialog did not preserve both versions: ${JSON.stringify({ local, disk })}`)
    }
  }

  async useDiskVersion() {
    await $("#use-disk-version").click()
    await $("#conflict-dialog").waitForDisplayed({ reverse: true })
  }

  async assertDiskSource(source) {
    const diskPath = path.join(process.env.ELEF_E2E_LIBRARY_ROOT, "E2E conflict", "presentation.md")
    await browser.waitUntil(async () => normalizeLineEndings(await readFile(diskPath, "utf8")) === source, {
      timeout: 10_000,
      timeoutMsg: "Using the disk version changed the external source bytes"
    })
    await browser.waitUntil(async () => await this.readSource() === source, {
      timeout: 10_000,
      timeoutMsg: "The editor did not load the external source after conflict resolution"
    })
  }

  async insertImage({ bytes, filename, mimeType }) {
    const setup = await browser.execute(({ bytes, filename, mimeType }) => {
      const field = document.querySelector("#desktop-editor-field")
      const controller = field?.editorController
      const form = document.querySelector("#desktop-editor-form")
      const input = document.querySelector('input[data-media-target="input"]')
      const media = form && globalThis.Stimulus?.getControllerForElementAndIdentifier(form, "media")
      if (!controller || !media || !input || typeof DataTransfer !== "function") return { error: "media controls were not ready" }
      controller.setSelectionRange(controller.sourceValue.length)
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], filename, { type: mimeType }))
      input.files = transfer.files
      if (input.files.length !== 1) return { error: "WebKit did not accept the image fixture" }
      void media.selected()
      return { started: true }
    }, { bytes: [...bytes], filename, mimeType })
    if (setup.error) throw new Error(`The desktop media controller did not accept the image fixture: ${setup.error}`)
    if (!setup.started) throw new Error("The desktop media controller did not start the image upload")
    try {
      await browser.waitUntil(async () => (await this.readSource()).includes(PIXEL_PNG_MARKDOWN), {
        timeout: 10_000,
        timeoutMsg: "The desktop media controller did not upload and insert the image"
      })
    } catch (error) {
      const state = await browser.execute(() => ({
        status: document.querySelector("#desktop-editor-form [data-media-target='status']")?.textContent || "",
        busy: document.querySelector("#desktop-editor-form [data-media-target='status']")?.getAttribute("aria-busy"),
        source: document.querySelector("#desktop-editor-field")?.editorController?.sourceValue || "",
        uploadUrl: document.querySelector("#desktop-editor-form")?.dataset.mediaUploadUrlValue || "",
        fileCount: document.querySelector('input[data-media-target="input"]')?.files?.length || 0
      }))
      throw new Error(`${error.message}; desktop media state: ${JSON.stringify(state)}`)
    }
    const status = await browser.execute(() =>
      document.querySelector("#desktop-editor-form [data-media-target='status']")?.textContent || ""
    )
    if (!status.includes("added to the Markdown source")) {
      throw new Error(`The desktop media controller did not finish the upload: ${status}`)
    }
    return this.readSource()
  }

  async waitForImage(digest) {
    await browser.waitUntil(async () => browser.execute(expectedDigest =>
      [...document.querySelectorAll('img[data-editor-image-source="true"]')].some(image =>
        image.src.includes(expectedDigest) && image.complete && image.naturalWidth > 0
      ), digest), {
      timeout: 10_000,
      timeoutMsg: "The desktop asset protocol did not render the uploaded image"
    })
  }
}

class DesktopLibraryUi {
  async openLibrary() {
    if (!(await $("#library-view").isDisplayed())) {
      await $("#back-to-library").click()
      await $("#library-view").waitForDisplayed()
    }
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

  async openElefArchive() {
    await this.openLibrary()
    await browser.execute(() => window.focus())
    const launched = spawn(process.env.ELEF_E2E_APP_BINARY, [process.env.ELEF_E2E_IMPORT_ARCHIVE], {
      stdio: "ignore"
    })
    let launchError = null
    let launchExit = null
    launched.once("error", error => { launchError = error })
    launched.once("exit", (code, signal) => { launchExit = { code, signal } })
    try {
      const card = $('[aria-label="Open E2E archive seed"]')
      try {
        await browser.waitUntil(async () => {
          if (launchError) throw new Error(`Opening the .elef file failed: ${launchError.message}`)
          return card.isDisplayed()
        }, {
          timeout: 20_000,
          timeoutMsg: "The running desktop app did not import the opened .elef file"
        })
      } catch (error) {
        const state = await browser.execute(() => ({
          status: document.querySelector("#status-text")?.textContent || "",
          notice: document.querySelector("#notice")?.textContent || "",
          cards: [...document.querySelectorAll(".deck-card")].map(card => card.getAttribute("aria-label"))
        })).catch(() => ({ unavailable: true }))
        throw new Error(`${error.message}; launch exit: ${JSON.stringify(launchExit)}; library state: ${JSON.stringify(state)}`)
      }
      await card.click()
      await browser.waitUntil(async () => (await $("#deck-title").getText()) === "E2E archive seed", {
        timeout: 10_000,
        timeoutMsg: "The imported .elef deck did not open"
      })
      const source = await browser.execute(() => document.querySelector("#desktop-editor-field")?.editorController?.sourceValue || "")
      if (!source.includes("Portable archive fixture.")) throw new Error("The imported .elef source was not loaded")
    } finally {
      if (launched.exitCode === null && launched.signalCode === null) {
        launched.kill("SIGTERM")
        await Promise.race([
          new Promise(resolve => launched.once("exit", resolve)),
          new Promise(resolve => setTimeout(resolve, 1_000))
        ])
        if (launched.exitCode === null && launched.signalCode === null) launched.kill("SIGKILL")
      }
    }
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

  it("opens and cancels the native library folder picker", async () => {
    await $("#change-library").click()
    if (process.platform === "darwin") {
      await browser.pause(500)
      execFileSync("osascript", ["-e", 'tell application "System Events" to key code 53'], { timeout: 5_000 })
    } else if (process.platform === "linux") {
      // Address the native chooser by title because it is outside the webview
      // and cannot be driven through the embedded WebDriver session.
      let dialogId
      await browser.waitUntil(async () => {
        try {
          dialogId = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "Choose your Elef library folder"], { encoding: "utf8" })
            .trim().split(/\s+/).at(-1)
          return Boolean(dialogId)
        } catch (_error) {
          return false
        }
      }, {
        timeout: 5_000,
        timeoutMsg: "The native library folder picker did not open"
      })
      execFileSync("xdotool", ["windowactivate", "--sync", dialogId], { timeout: 5_000 })
      execFileSync("xdotool", ["key", "--clearmodifiers", "Escape"], { timeout: 5_000 })
    } else {
      throw new Error(`Native folder picker smoke is unsupported on ${process.platform}`)
    }
    await browser.waitUntil(async () => (await $("#status-text").getText()) === "Library selection cancelled", {
      timeout: 10_000,
      timeoutMsg: "The native library folder picker did not cancel cleanly"
    })
  })

  it("runs the shared library and document graph flow", async () => {
    await libraryAndGraphWorkflow(new DesktopLibraryUi())
  })

  it("runs the shared external-edit conflict flow in the desktop binary", async () => {
    const ui = new DesktopEditorUi()
    await externalEditConflictWorkflow(ui)
    if (await ui.readSource() !== CONFLICT_EXTERNAL_SOURCE) {
      throw new Error("Resolving the conflict did not load the external source")
    }
  })

  it("imports a portable .elef opened by the running application", async () => {
    await new DesktopLibraryUi().openElefArchive()
  })

  it("edits, saves, and previews a deck in the desktop binary", async () => {
    await editAndPreviewWorkflow(new DesktopEditorUi())
    const form = await $("#desktop-editor-form")
    if (await form.getAttribute("data-editor-mode") !== "visual") {
      throw new Error("The editor did not switch into visual mode")
    }
  })
})
