import assert from "node:assert/strict"
import { $, $$, browser } from "@wdio/globals"
import { Key } from "webdriverio"
import { execFileSync, spawn } from "node:child_process"
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { editAndPreviewWorkflow } from "../../../../apps/web/test/e2e/scenarios/edit-and-preview.js"
import { appearanceWorkflow } from "../../../../apps/web/test/e2e/scenarios/appearance.js"
import { libraryAndGraphWorkflow } from "../../../../apps/web/test/e2e/scenarios/library-and-graph.js"
import { libraryCreateDeleteWorkflow } from "../../../../apps/web/test/e2e/scenarios/library-create-delete.js"
import { libraryDeepLinksWorkflow } from "../../../../apps/web/test/e2e/scenarios/library-deep-links.js"
import { externalEditConflictWorkflow, CONFLICT_WORK_NAME, CONFLICT_SOURCE_FILE, CONFLICT_EXTERNAL_SOURCE } from "../../../../apps/web/test/e2e/scenarios/external-edit-conflict.js"
import { hostileWorkNeutralizedWorkflow } from "../../../../apps/web/test/e2e/scenarios/hostile-work.js"
import { documentLinkCompletionWorkflow, mathInputWorkflow, snippetInsertWorkflow } from "../../../../apps/web/test/e2e/scenarios/authoring-palettes.js"
import { authoringSettingsWorkflow } from "../../../../apps/web/test/e2e/scenarios/authoring-settings.js"
import { PIXEL_PNG_BYTES, PIXEL_PNG_DIGEST, PIXEL_PNG_MARKDOWN } from "../../../../apps/web/test/e2e/scenarios/media-fixture.js"
import { presentationModeWorkflow } from "../../../../apps/web/test/e2e/scenarios/presentation-mode.js"
import { vimRelativeLineNumbersWorkflow } from "../../../../apps/web/test/e2e/scenarios/vim-relative-line-numbers.js"
import { documentPageAspectRatioWorkflow } from "../../../../apps/web/test/e2e/scenarios/document-page-aspect-ratio.js"
import { exportWorkflow } from "../../../../apps/web/test/e2e/scenarios/export.js"
import { slidePositionGrammarWorkflow } from "../../../../apps/web/test/e2e/scenarios/slide-position-grammar.js"
import { displayMathEnterWorkflow } from "../../../../apps/web/test/e2e/scenarios/display-math-enter.js"
import { artRenderingWorkflow } from "../../../../apps/web/test/e2e/scenarios/art-rendering.js"
import { richRenderingMediaWorkflow } from "../../../../apps/web/test/e2e/scenarios/rich-rendering-media.js"
import { setupRichRenderingWork, teardownRichRenderingWork } from "../seed-rich-rendering.mjs"
import { createHash } from "node:crypto"
import { answerMacNativeDialog } from "../mac-native-dialog.js"

async function openDesktopAuthoringSettings() {
  await openDesktopSettings()
  await $("#manage-authoring").click()
  await $("#authoring-settings-dialog").waitForDisplayed()
}

async function openDesktopSettings() {
  await browser.execute(() => window.focus())
  if (process.platform === "darwin") {
    execFileSync("osascript", ["-e", 'tell application "System Events" to keystroke "," using {command down}'], { timeout: 5_000 })
  } else if (process.platform === "linux") {
    execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+comma"], { timeout: 5_000 })
  } else {
    throw new Error(`Settings menu smoke is unsupported on ${process.platform}`)
  }
  await $("#settings-dialog").waitForDisplayed()
}

async function confirmAuthoringDeletion(expectedName) {
  const dialog = $("#delete-authoring-dialog")
  await dialog.waitForDisplayed()
  const message = await $("#delete-authoring-message").getText()
  if (!message.includes(expectedName)) throw new Error(`Unexpected deletion prompt: ${message}`)
  await $("#confirm-authoring-delete").click()
}

function normalizeLineEndings(source) {
  return source.replace(/\r\n/g, "\n")
}

function desktopProcessId() {
  const pids = execFileSync("pgrep", ["-x", "elef-desktop"], { encoding: "utf8", timeout: 5_000 })
    .trim().split(/\s+/).filter(Boolean)
  if (pids.length !== 1 || !/^\d+$/.test(pids[0])) {
    throw new Error(`Expected one desktop application process, found ${pids.length}`)
  }
  return Number(pids[0])
}

function focusDesktopWindow() {
  const pid = desktopProcessId()
  if (process.platform === "linux") {
    const windowIds = execFileSync("xdotool", ["search", "--sync", "--onlyvisible", "--pid", String(pid)], {
      encoding: "utf8", timeout: 5_000
    }).trim().split(/\s+/).filter(Boolean)
    if (!windowIds.length) throw new Error("The desktop application has no visible window")
    execFileSync("xdotool", ["windowactivate", "--sync", windowIds[0]], { timeout: 5_000 })
    return
  }
  if (process.platform === "darwin") {
    execFileSync("osascript", ["-e", `tell application "System Events"
      set frontmost of (first application process whose unix id is ${pid}) to true
    end tell`], { timeout: 5_000 })
    return
  }
  throw new Error(`Native window activation is unsupported on ${process.platform}`)
}

function sendNativeKey(key, { activate = true } = {}) {
  const linuxKeys = {
    Escape: "Escape", Enter: "Return", Backspace: "BackSpace", ArrowRight: "Right", ArrowLeft: "Left", Home: "Home", End: "End"
  }
  const macKeyCodes = { Escape: 53, Enter: 36, Backspace: 51, ArrowRight: 124, ArrowLeft: 123, Home: 115, End: 119 }
  if (process.platform === "linux") {
    if (activate) focusDesktopWindow()
    const nativeKey = linuxKeys[key]
    if (!nativeKey) throw new Error(`Unsupported native key ${key}`)
    execFileSync("xdotool", ["key", "--clearmodifiers", nativeKey], { timeout: 5_000 })
    return
  }
  if (process.platform === "darwin") {
    if (activate) focusDesktopWindow()
    const keyCode = macKeyCodes[key]
    if (keyCode === undefined) throw new Error(`Unsupported native key ${key}`)
    execFileSync("osascript", ["-e", `tell application "System Events" to key code ${keyCode}`], { timeout: 5_000 })
    return
  }
  throw new Error(`Native keyboard input is unsupported on ${process.platform}`)
}

async function logDesktopAppState(label) {
  try {
    const state = await browser.execute(() => ({
      bodyClass: document.body.className,
      libraryHidden: document.querySelector("#library-view")?.hidden ?? null,
      libraryDisplay: (() => {
        const view = document.querySelector("#library-view")
        return view ? getComputedStyle(view).display : null
      })(),
      workHidden: document.querySelector("#work-view")?.hidden ?? null,
      editorMode: document.querySelector("#desktop-editor-form")?.dataset.editorMode ?? null,
      loadedWorkId: document.querySelector("#desktop-editor-form")?.dataset.loadedWorkId ?? null,
      workId: document.querySelector("#work-id")?.textContent ?? null,
      presentationExitHidden: document.querySelector("#exit-presentation")?.hidden ?? null,
      openDialogs: [...document.querySelectorAll("dialog")].filter(dialog => dialog.open).map(dialog => dialog.id),
      saveStatus: (() => {
        try {
          return window.__elefSaveTestHooks?.saveStatus?.() ?? null
        } catch (_error) {
          return "hook-error"
        }
      })(),
      presentationKeys: globalThis.__elefPresentationKeyEvents ?? null
    }))
    console.log(`ELEF-APP-STATE ${label}: ${JSON.stringify(state)}`)
  } catch (error) {
    console.log(`ELEF-APP-STATE ${label}: unavailable (${error.message})`)
  }
}

async function sendPresentationKey(key) {
  await browser.execute(() => window.focus())
  if (process.platform === "darwin") {
    focusDesktopWindow()
    if (key === "Home" || key === "End") {
      // The embedded WebDriver forwards its private-use Home/End codes as
      // event.key instead of the standard key names expected by the shared
      // presentation controller. Dispatch the canonical key event at the
      // same document listener used by real keyboard input.
      await browser.execute(name => document.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })), key)
      return
    }
    const webDriverKey = {
      Escape: Key.Escape,
      ArrowRight: Key.ArrowRight,
      ArrowLeft: Key.ArrowLeft,
    }[key]
    if (!webDriverKey) throw new Error(`Unsupported presentation key ${key}`)
    await browser.keys(webDriverKey)
    return
  }
  // An xdotool keystroke under xvfb occasionally never reaches the WebView:
  // the window can lose the focus race after the native fullscreen
  // transition. A lost Escape wedges the shared app in presentation mode and
  // cascades into every later navigation, so resend once when the key
  // demonstrably did not land. enterPresentationMode records each delivered
  // keydown; a key that lands but fails to act still fails loudly below, so
  // the retry never masks a product regression.
  const captureInstalled = await browser.execute(() => Array.isArray(globalThis.__elefPresentationKeyEvents))
  if (!captureInstalled) {
    sendNativeKey(key)
    return
  }
  const receivedCount = () => browser.execute(name =>
    (globalThis.__elefPresentationKeyEvents || []).filter(event => event.key === name).length, key)
  const before = await receivedCount()
  const landed = async () => (await receivedCount()) > before
  for (let attempt = 0; attempt < 2; attempt++) {
    sendNativeKey(key)
    try {
      await browser.waitUntil(landed, {
        timeout: attempt === 0 ? 2_000 : 5_000,
        interval: 100,
        timeoutMsg: `The ${key} keypress never reached the desktop presentation`
      })
      return
    } catch (error) {
      if (attempt === 1) throw error
    }
  }
}

async function desktopWindowIsFullscreen() {
  return browser.executeAsync(done => {
    const currentWindow = window.__TAURI__?.window?.getCurrentWindow?.()
    if (!currentWindow) return done(false)
    currentWindow.isFullscreen().then(done, () => done(false))
  })
}

function typeNativeText(value, { activate = true } = {}) {
  if (process.platform === "linux") {
    if (activate) focusDesktopWindow()
    execFileSync("xdotool", ["type", "--clearmodifiers", "--delay", "10", value], { timeout: 10_000 })
    return
  }
  if (process.platform === "darwin") {
    const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
    execFileSync("osascript", ["-e", `tell application "System Events" to keystroke "${escaped}"`], { timeout: 10_000 })
    return
  }
  throw new Error(`Native keyboard input is unsupported on ${process.platform}`)
}

class DesktopEditorUi {
  async setAppearance(key, value) {
    const panel = await $(".appearance-settings")
    if (await panel.getAttribute("open") === null) await panel.$("summary").click()
    // The pinned embedded driver's click_element calls option.click(), which
    // does not select an option. Drive the normal DOM value/input/change seam;
    // retain all real Appearance/controller/save/render behavior after it.
    await browser.execute((styleKey, selectedValue) => {
      const select = document.querySelector(`.appearance-settings [data-appearance-target='${styleKey}']`)
      if (!select || select.disabled || ![...select.options].some(option => option.value === selectedValue)) {
        throw new Error("The requested Appearance option is unavailable")
      }
      select.value = selectedValue
      select.dispatchEvent(new Event("input", { bubbles: true }))
      select.dispatchEvent(new Event("change", { bubbles: true }))
    }, key, value)
    await browser.waitUntil(async () => new RegExp(`^${key}: ${value}$`, "m").test(await this.readSource()), {
      timeout: 10_000, timeoutMsg: "The appearance choice did not update the source"
    })
    await $(`#desktop-editor-form [class*='slides-${key}-${value}']`).waitForDisplayed()
  }

  async assertAppearance(theme, typography) {
    await $(`#desktop-editor-form .slides-theme-${theme}.slides-typography-${typography}`).waitForDisplayed()
  }

  async openAuthoringSettings() {
    await openDesktopAuthoringSettings()
  }

  async closeAuthoringSettings() {
    await $("#close-authoring-settings").click()
    await $("#authoring-settings-dialog").waitForDisplayed({ reverse: true })
  }

  async selectAuthoringRegistry(registry) {
    const tab = $(`[data-authoring-tab='${registry}']`)
    await tab.click()
    await browser.waitUntil(async () => (await tab.getAttribute("aria-selected")) === "true", {
      timeout: 5_000,
      timeoutMsg: `The ${registry} authoring settings tab did not open`
    })
  }

  async findAuthoringEntryCard(searchText) {
    for (const card of await $$(".authoring-entry-card")) {
      if ((await card.getText()).includes(searchText)) return card
    }
    return null
  }

  async assertBuiltInAuthoringEntryReadOnly(name) {
    const card = await this.findAuthoringEntryCard(name)
    if (!card || !(await card.getText()).includes("Built-in")) {
      throw new Error(`Built-in authoring entry ${name} was not visible`)
    }
    if ((await card.$$(".authoring-entry-actions")).length) {
      throw new Error(`Built-in authoring entry ${name} exposed edit or delete actions`)
    }
  }

  async createAuthoringEntry(registry, fields) {
    await $("#new-authoring-entry").click()
    await this.fillAuthoringEntryForm(registry, fields)
    await $("#save-authoring-entry").click()
    const label = registry === "snippets" ? "snippet" : "math shortcut"
    await this.waitForAuthoringSettingsStatus(`New entry saved (${label}).`)
  }

  async editAuthoringEntry(registry, searchText, fields) {
    const card = await this.findAuthoringEntryCard(searchText)
    if (!card) throw new Error(`Could not find authoring entry ${searchText} to edit`)
    const actions = await card.$$(".authoring-entry-actions button")
    if (!actions.length) throw new Error(`Authoring entry ${searchText} has no edit action`)
    await actions[0].click()
    await this.fillAuthoringEntryForm(registry, fields)
    await $("#save-authoring-entry").click()
    const label = registry === "snippets" ? "snippet" : "math shortcut"
    await this.waitForAuthoringSettingsStatus(`Changes saved (${label}).`)
  }

  async deleteAuthoringEntry(registry, searchText) {
    const card = await this.findAuthoringEntryCard(searchText)
    if (!card) throw new Error(`Could not find authoring entry ${searchText} to delete`)
    await card.$(".authoring-delete").click()
    const name = (await $("#delete-authoring-message").getText()).match(/“([^”]+)”/)?.[1]
    if (!name) throw new Error("The authoring deletion confirmation did not name the entry")
    await confirmAuthoringDeletion(name)
    const label = registry === "snippets" ? "snippet" : "math shortcut"
    await this.waitForAuthoringSettingsStatus(`Entry deletion saved (${label}).`)
  }

  async assertAuthoringEntryVisible(searchText) {
    if (!await this.findAuthoringEntryCard(searchText)) throw new Error(`Authoring entry ${searchText} was not listed`)
  }

  async assertAuthoringEntryMissing(searchText) {
    if (await this.findAuthoringEntryCard(searchText)) throw new Error(`Deleted authoring entry ${searchText} remains listed`)
  }

  async waitForAuthoringSettingsStatus(expected) {
    await browser.waitUntil(async () => (await $("#authoring-settings-status").getText()) === expected, {
      timeout: 10_000,
      timeoutMsg: `Expected authoring settings status: ${expected}`
    })
  }

  async fillAuthoringEntryForm(registry, fields) {
    if (registry === "snippets") {
      await $("#authoring-name").setValue(fields.name)
      await $("#authoring-trigger").setValue(fields.trigger)
      await $("#authoring-description").setValue(fields.description)
      await $("#authoring-category").selectByVisibleText(fields.category)
      await $("#authoring-body").setValue(fields.body)
      return
    }
    await $("#authoring-math-name").setValue(fields.name)
    await browser.execute(prefixValue => {
      const prefix = document.querySelector("#authoring-prefix")
      if (!prefix || ![...prefix.options].some(option => option.value === prefixValue)) {
        throw new Error("The math shortcut prefix is unavailable")
      }
      prefix.value = prefixValue
      prefix.dispatchEvent(new Event("input", { bubbles: true }))
      prefix.dispatchEvent(new Event("change", { bubbles: true }))
    }, fields.prefix)
    await $("#authoring-aliases").setValue(fields.aliases)
    await $("#authoring-math-description").setValue(fields.description)
    await $("#authoring-expansion").setValue(fields.expansion)
  }

  constructor() {
    this.externalMediaPolicy = "reject-remote"
    this.activeWorkTitle = null
    this.capabilities = { export: true }
  }

  async pauseAutosave() {
    const paused = await browser.execute(() => {
      const hooks = window.__elefSaveTestHooks
      if (!hooks) return false
      hooks.pause()
      return true
    })
    if (!paused) throw new Error("The E2E desktop build did not expose the autosave test hook")
  }

  async flushLocalSave() {
    const result = await browser.executeAsync(done => {
      const hooks = window.__elefSaveTestHooks
      if (!hooks) return done({ error: "The E2E desktop build did not expose the autosave test hook" })
      hooks.flush().then(value => done({ value }), error => done({ error: error.message }))
    })
    if (result?.error) throw new Error(result.error)
  }

  async openWork(title = "E2E seed") {
    if (!(await $("#library-view").isDisplayed())) {
      if ((await $("#desktop-editor-form").getAttribute("data-editor-mode")) === "visual") {
        await this.showSourceMode()
      }
      await $("#back-to-library").click()
      await $("#library-view").waitForDisplayed()
    }
    await $("#show-work-list").click()
    const card = $(`[aria-label="Edit ${title}"]`)
    await card.waitForDisplayed()
    await card.click()
    try {
      await browser.waitUntil(async () => browser.execute(expected => {
        const form = document.querySelector("#desktop-editor-form")
        return document.querySelector("#work-title")?.textContent === expected
          && form?.dataset.loadedWorkId === document.querySelector("#work-id")?.textContent
          && form?.dataset.editorMode === "visual"
          && !document.querySelector("#visual-mode")?.disabled
          && !document.querySelector("#work-view")?.hidden
      }, title), {
        timeout: 10_000,
        timeoutMsg: `The ${title} work did not finish opening in visual mode`
      })
    } catch (error) {
      const diagnostic = await browser.execute(expected => {
        const form = document.querySelector("#desktop-editor-form")
        const editorField = document.querySelector("#desktop-editor-field")
        const visualButton = document.querySelector("#visual-mode")
        const previewController = form?.previewController
        const stimulus = window.Stimulus
        return {
          expected,
          editorMode: form?.dataset.editorMode || "",
          visualButtonDisabled: visualButton?.disabled ?? null,
          status: document.querySelector("#status-text")?.textContent || "",
          notice: document.querySelector("#notice")?.textContent || "",
          previewControllerConnected: Boolean(previewController),
          previewRequestInFlight: Boolean(previewController?.requestController),
          previewQueuedRequestId: previewController?.queuedRequestId ?? null,
          previewProjectionFresh: previewController?.projectionFresh ?? null,
          previewStatus: form?.querySelector("[data-preview-target='status']")?.textContent || "",
          previewWarnings: form?.querySelector("[data-preview-target='warnings']")?.textContent || "",
          previewChildren: form?.querySelector("#desktop-preview")?.childElementCount ?? null,
          previewTrace: window.__elefPreviewTrace?.slice(-8) || [],
          visualEditorConnected: Boolean(form?.visualEditorController),
          presentationEditorConnected: Boolean(form?.presentationEditorController),
          workTitle: document.querySelector("#work-title")?.textContent || "",
          workId: document.querySelector("#work-id")?.textContent || "",
          loadedWorkId: form?.dataset.loadedWorkId || "",
          editorControllers: editorField?.dataset.controller || "",
          editorFieldConnected: Boolean(editorField?.isConnected),
          editorControllerReady: editorField?.editorController?.editorReady ?? null,
          editorControllerRegistered: Boolean(stimulus?.router?.modulesByIdentifier?.has("editor")),
          editorControllerConnected: Boolean(editorField && stimulus?.getControllerForElementAndIdentifier?.(editorField, "editor")),
          controllerErrors: window.__elefE2EControllerErrors?.slice(-5) || [],
          codeMirrorMounted: Boolean(editorField?.querySelector(".cm-editor")),
          libraryHidden: document.querySelector("#library-view")?.hidden,
          workViewHidden: document.querySelector("#work-view")?.hidden,
          cardVisible: [...document.querySelectorAll(".library-card-open")].some(button => button.getAttribute("aria-label") === `Edit ${expected}`)
        }
      }, title)
      throw new Error(`${error.message}; desktop open diagnostic: ${JSON.stringify(diagnostic)}`)
    }
    this.activeWorkTitle = title
  }

  async openExportMenu() {
    const button = $("#export-menu-button")
    await button.waitForDisplayed()
    const isOpen = await browser.execute(() => document.querySelector("#export-menu")?.open === true)
    if (!isOpen) await button.click()
    await browser.waitUntil(async () => browser.execute(() => document.querySelector("#export-menu")?.open === true), {
      timeout: 5_000,
      timeoutMsg: "The desktop Export menu did not open"
    })
  }

  async assertExportMenuClosed(context) {
    await browser.waitUntil(async () => browser.execute(() => document.querySelector("#export-menu")?.open !== true), {
      timeout: 5_000,
      timeoutMsg: `The desktop Export menu stayed open after ${context}`
    })
  }

  async downloadPptx() {
    await this.openWork("E2E seed")
    const pptxPath = process.env.ELEF_E2E_PPTX_EXPORT_PATH
    if (!pptxPath) throw new Error("ELEF_E2E_PPTX_EXPORT_PATH is not set for the desktop PPTX export")
    await rm(pptxPath, { force: true })
    await this.openExportMenu()
    const trigger = $("#export-pptx")
    await trigger.waitForDisplayed()
    await trigger.click()
  }

  async assertPptxDownloaded() {
    const pptxPath = process.env.ELEF_E2E_PPTX_EXPORT_PATH
    if (!pptxPath) throw new Error("ELEF_E2E_PPTX_EXPORT_PATH is not set for the desktop PPTX export")
    // The work-view Export menu option drives the real transport + real
    // engine + real save command; the harness bypass writes the chosen path
    // instead of a native dialog (mirroring ELEF_E2E_EXPORT_PATH).
    try {
      await browser.waitUntil(async () => (await $("#export-pptx-status").getText()) === "PowerPoint exported.", {
        timeout: 30_000,
        timeoutMsg: "The desktop PPTX export did not report success"
      })
    } catch (error) {
      throw new Error(`The desktop PPTX export did not report success (${await this.diagnosePptxExportFailure()})`, { cause: error })
    }
    await this.assertExportMenuClosed("the PPTX export")
    const bytes = await readFile(pptxPath)
    if (bytes.subarray(0, 4).toString("binary") !== "PK\x03\x04") {
      throw new Error("The exported PPTX is not a valid zip archive")
    }
    const listing = execFileSync("unzip", ["-l", pptxPath], { encoding: "utf8" })
    if (!listing.includes("ppt/slides/slide1.xml")) {
      throw new Error(`The exported PPTX contains no slide: ${listing}`)
    }
    const mediaEntries = [...listing.matchAll(/ppt\/media\/\S+/g)].map((match) => match[0])
    if (!mediaEntries.length) throw new Error(`The exported PPTX embeds no media: ${listing}`)
    // The seed deck carries the shared pixel fixture by now (the shared
    // edit flow inserted it before this scenario runs): its bytes must be
    // embedded verbatim, proving local IPC media resolution end to end.
    if ((await this.readSource()).includes("elef-asset:")) {
      const embedded = mediaEntries.some((entry) =>
        Buffer.from(execFileSync("unzip", ["-p", pptxPath, entry])).equals(PIXEL_PNG_BYTES)
      )
      if (!embedded) throw new Error(`The exported PPTX does not embed the deck image: ${mediaEntries.join(", ")}`)
    }
  }

  // Failure-only probe: replays each export seam in the live app so a CI
  // timeout names the failing stage (status, IPC, library) instead of
  // only the wait. Never runs on success; never writes files.
  async diagnosePptxExportFailure() {
    const source = await this.readSource().catch(() => "<source unreadable>")
    const digest = /elef-asset:([0-9a-f]{64})/i.exec(source)?.[1] ?? null
    const probe = await browser.execute(async (assetDigest) => {
      const out = {}
      out.statusCount = document.querySelectorAll("#export-pptx-status").length
      out.statusText = document.querySelector("#export-pptx-status")?.textContent ?? null
      out.statusStack = document.querySelector("#export-pptx-status")?.dataset?.errorStack?.slice(0, 1200) ?? null
      out.appStatus = document.querySelector("#status-text")?.textContent?.slice(0, 160) ?? null
      out.exportMenuOpen = document.querySelector("#export-menu")?.open ?? null
      out.desktopView = document.body.dataset.desktopView ?? null
      out.workHidden = document.querySelector("#work-view")?.hidden ?? null
      out.pptxInstalled = typeof window.PptxGenJS !== "undefined"
      out.invokeType = typeof window.__TAURI__?.core?.invoke
      const workId = document.querySelector("#desktop-editor-form")?.dataset.loadedWorkId ?? null
      out.workId = workId
      if (!workId || typeof window.__TAURI__?.core?.invoke !== "function") return out
      try {
        const media = await window.__TAURI__.core.invoke("list_media", { id: workId })
        out.listMedia = `ok:${Array.isArray(media) ? media.length : typeof media}`
      } catch (error) {
        out.listMedia = `THREW:${error?.message ?? JSON.stringify(error)}`
        return out
      }
      if (!assetDigest) {
        out.readAsset = "skipped:no-digest-in-source"
        return out
      }
      try {
        const uri = await window.__TAURI__.core.invoke("read_pptx_asset", { id: workId, digest: assetDigest })
        out.readAsset = (typeof uri === "string" && uri.startsWith("data:")) ? `ok:${uri.length}` : `unexpected:${String(uri).slice(0, 80)}`
      } catch (error) {
        out.readAsset = `THREW:${error?.message ?? JSON.stringify(error)}`
      }
      // Failure path only (the spec already failed): replay the save seam
      // with a realistic payload size through the harness bypass.
      try {
        const saved = await window.__TAURI__.core.invoke("save_pptx_bytes", { filename: "probe.pptx", bytes: new Array(600000).fill(7) })
        out.saveBytes = `ok:${saved}`
      } catch (error) {
        out.saveBytes = `THREW:${error?.message ?? JSON.stringify(error)}`
      }
      return out
    }, digest).catch((error) => ({ probeFailed: String(error).slice(0, 200) }))
    const logs = typeof browser.getLogs === "function" ? await browser.getLogs("browser").catch(() => []) : []
    const consoleTail = logs.slice(-6).map((entry) => String(entry?.message ?? entry).slice(0, 160))
    return `probe:${JSON.stringify(probe)} sourceHasAsset:${source.includes("elef-asset:")} console:${JSON.stringify(consoleTail)}`
  }

  async enableVimRelativeLineNumbers() {
    await openDesktopSettings()
    // The desktop settings surface is the shared settings page (the same
    // component and element ids as the web /settings page). Prove the
    // parity contract first: identical defaults controls and options.
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector("#settings-page-mount .settings-page") !== null
    ), {
      timeout: 10_000,
      timeoutMsg: "The shared settings page did not mount in the desktop settings dialog"
    })
    const optionValues = await browser.execute(() => ({
      theme: [...document.querySelectorAll("#settings-theme option")].map(option => option.value),
      typography: [...document.querySelectorAll("#settings-typography option")].map(option => option.value)
    }))
    if (JSON.stringify(optionValues.theme) !== JSON.stringify(["match", "light", "dark"])) {
      throw new Error(`Desktop settings themes diverged from the shared page: ${JSON.stringify(optionValues.theme)}`)
    }
    if (JSON.stringify(optionValues.typography) !== JSON.stringify(["book", "modern", "technical"])) {
      throw new Error(`Desktop settings typographies diverged from the shared page: ${JSON.stringify(optionValues.typography)}`)
    }
    // Round-trip a workspace default through the shared form, then restore
    // it so later tests keep the default library appearance.
    await this.saveSharedWorkspaceDefault("#settings-typography", "modern")
    await this.saveSharedWorkspaceDefault("#settings-typography", "book")
    // Vim preferences render through the shared client UI (same device
    // storage keys, same editor bridge); drive its stable hooks.
    const vimToggle = $("#vim-enabled")
    if (!(await vimToggle.isSelected())) await vimToggle.click()
    // The embedded driver's option click does not update native <select>s.
    // Exercise the same input/change seam as a browser selection.
    await browser.execute(() => {
      const select = document.querySelector("#vim-line-numbers")
      select.value = "relative"
      select.dispatchEvent(new Event("input", { bubbles: true }))
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await browser.waitUntil(async () => browser.execute(() =>
      localStorage.getItem("elef.editor.lineNumbers") === "relative"
    ), {
      timeout: 5_000,
      timeoutMsg: "The native Vim settings control did not save relative line numbers"
    })
    await $("#close-settings").click()
    await $("#settings-dialog").waitForDisplayed({ reverse: true })
  }

  async saveSharedWorkspaceDefault(selectId, value) {
    await browser.execute((id, selectedValue) => {
      const select = document.querySelector(id)
      select.value = selectedValue
      select.dispatchEvent(new Event("input", { bubbles: true }))
      select.dispatchEvent(new Event("change", { bubbles: true }))
    }, selectId, value)
    await $("button=Save workspace defaults").click()
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector("#settings-page-mount .settings-notice")?.textContent === "Workspace appearance saved."
    ), {
      timeout: 10_000,
      timeoutMsg: "The shared workspace-defaults form did not report a save"
    })
  }

  async reopenWork() {
    await this.openWork(this.activeWorkTitle || "E2E seed")
  }

  async enterPresentationMode() {
    const geometry = await browser.execute(() => {
      const slide = document.querySelector("#desktop-preview .slide-frame > .slide")
      if (!slide) return null
      const style = getComputedStyle(slide)
      return { width: style.width, height: style.height, overflow: style.overflow }
    })
    if (geometry?.width !== "1280px" || geometry.height !== "720px" || geometry.overflow !== "hidden") {
      throw new Error(`The native presentation preview violated its 16:9 canvas contract: ${JSON.stringify(geometry)}`)
    }

    const started = await browser.executeAsync(done => {
      const start = window.__elefPresentationTestHooks?.start
      if (!start) return done({ error: "The presentation shell is unavailable" })
      start().then(() => done({ started: document.body.classList.contains("presenting-work") }))
        .catch(error => done({ error: error.message || String(error) }))
    })
    if (started.error || !started.started) throw new Error(started.error || "Desktop presentation mode did not start")
    await browser.execute(() => {
      const capture = event => {
        const events = globalThis.__elefPresentationKeyEvents ||= []
        events.push({ key: event.key, trusted: event.isTrusted })
      }
      globalThis.__elefPresentationKeyCapture = capture
      document.addEventListener("keydown", capture, true)
    })
    await browser.waitUntil(async () => (await $$("#desktop-preview .slide-frame")).length === 2, {
      timeout: 5_000,
      timeoutMsg: "Desktop presentation mode did not find both rendered slides"
    })
  }

  async assertPresentationSlide(index, title) {
    const state = await browser.execute(() => ({
      slides: [...document.querySelectorAll("#desktop-preview .slide-frame")].map(frame => ({
        text: frame.textContent,
        hidden: frame.hidden,
        active: frame.classList.contains("is-active-presentation-slide")
      })),
      hasFocus: document.hasFocus(),
      activeElement: document.activeElement && {
        tag: document.activeElement.tagName,
        id: document.activeElement.id,
        className: String(document.activeElement.className || "")
      },
      keys: globalThis.__elefPresentationKeyEvents || []
    }))
    const states = state.slides
    if (states.length !== 2 || !states[index].text.includes(title) || states[index].hidden || !states[index].active) {
      throw new Error(`Unexpected active desktop presentation slide: ${JSON.stringify(state)}`)
    }
    const other = states[1 - index]
    if (!other.hidden || other.active) throw new Error(`Another desktop slide remained visible: ${JSON.stringify(states)}`)
  }

  async assertPresentationText(index, text, visible) {
    const state = await browser.execute((slideIndex, content) => {
      const frame = document.querySelectorAll("#desktop-preview .slide-frame")[slideIndex]
      const block = [...(frame?.querySelectorAll(".slide-block[data-elef-reveal-event]") || [])]
        .find(element => element.textContent.includes(content))
      if (!block) return null
      return {
        visibility: getComputedStyle(block).visibility,
        ariaHidden: block.getAttribute("aria-hidden"),
        inert: block.hasAttribute("inert")
      }
    }, index, text)
    if (!state) throw new Error(`Could not find reveal block ${JSON.stringify(text)} on slide ${index + 1}`)
    const expectedVisibility = visible ? "visible" : "hidden"
    if (state.visibility !== expectedVisibility || state.ariaHidden !== (visible ? null : "true") || state.inert !== !visible) {
      throw new Error(`Unexpected reveal state for ${JSON.stringify(text)}: ${JSON.stringify(state)}`)
    }
  }

  async assertSlidePositionGrammar() {
    const inspect = () => browser.execute(() => {
      const root = document.querySelector("#desktop-preview")
      const slide = root?.querySelector(".slide")
      const content = slide?.querySelector(".slide-content")
      const group = slide?.querySelector(".slide-middle-group")
      const lane = slide?.querySelector(".slide-bottom-lane")
      const blocks = element => [...(element?.querySelectorAll(".slide-block") || [])]
      const rect = element => element.getBoundingClientRect()
      return {
        groups: [...(slide?.querySelectorAll(".slide-middle-group") || [])].map(group => blocks(group).map(block => block.textContent.trim())),
        lanes: [...(slide?.querySelectorAll(".slide-bottom-lane") || [])].map(lane => blocks(lane).map(block => block.textContent.trim())),
        flushBottom: group?.classList.contains("flush-bottom") || false,
        blockGap: blocks(group).length > 1 ? rect(blocks(group)[1]).top - rect(blocks(group)[0]).bottom : null,
        laneBottomGap: content && lane ? rect(content).bottom - rect(lane).bottom : null,
        classes: blocks(slide).map(block => block.className)
      }
    })
    const groups = [["Alignment stack", "Subtitle"]]
    const lanes = [["Footer"]]
    await browser.waitUntil(async () => {
      const measurements = await inspect()
      return JSON.stringify(measurements.groups) === JSON.stringify(groups) &&
        JSON.stringify(measurements.lanes) === JSON.stringify(lanes) && measurements.flushBottom
    }, { timeout: 10_000, timeoutMsg: "The desktop preview did not render the middle stack and bottom lane" })

    const measurements = await inspect()
    if (measurements.blockGap >= 8 || Math.abs(measurements.laneBottomGap) > 1 ||
        !measurements.classes[0]?.includes("position-center position-middle") ||
        !measurements.classes[1]?.includes("position-center position-top") ||
        !measurements.classes[2]?.includes("position-right position-bottom")) {
      throw new Error(`Desktop slide position grammar did not match the expected layout: ${JSON.stringify(measurements)}`)
    }
  }

  async assertColumnSlidePositionDocking() {
    const inspect = () => browser.execute(() => {
      const root = document.querySelector("#desktop-preview")
      const slide = root?.querySelector(".slide")
      const regions = [...(slide?.querySelectorAll(".slide-region") || [])]
      const left = regions[0]
      const group = left?.querySelector(".slide-middle-group.flush-bottom")
      const lane = left?.querySelector(".slide-bottom-lane")
      const blockText = element => [...(element?.querySelectorAll(".slide-block") || [])]
        .map(block => block.textContent.trim()).join(" ")
      const rect = element => element.getBoundingClientRect()
      return {
        regionCount: regions.length,
        leftGroup: blockText(group),
        leftLane: blockText(lane),
        rightHasPlacement: Boolean(regions[1]?.querySelector(".slide-middle-group, .slide-bottom-lane")),
        dockGap: group && lane ? rect(lane).top - rect(group).bottom : null,
        laneBottomGap: left && lane ? rect(left).bottom - rect(lane).bottom : null
      }
    })
    await browser.waitUntil(async () => {
      const measurements = await inspect()
      return measurements.regionCount === 2 &&
        measurements.leftGroup === "Left stack" &&
        measurements.leftLane === "Left footer" &&
        !measurements.rightHasPlacement
    }, { timeout: 10_000, timeoutMsg: "The desktop preview did not render column docking" })

    const measurements = await inspect()
    if (Math.abs(measurements.dockGap) > 1 || Math.abs(measurements.laneBottomGap) > 1) {
      throw new Error(`Desktop column docking left a gap: ${JSON.stringify(measurements)}`)
    }
  }

  async movePresentation(key) {
    await sendPresentationKey(key)
  }

  async exitPresentationMode() {
    await sendPresentationKey("Escape")
    await browser.waitUntil(async () => !(await browser.execute(() => document.body.classList.contains("presenting-work"))), {
      timeout: 5_000,
      timeoutMsg: "Escape did not exit desktop presentation mode"
    })
  }

  async returnToEditor() {
    if (await browser.execute(() => document.body.classList.contains("presenting-work"))) {
      // Keep a failed Escape assertion from leaving this shared fixture work in
      // presentation-test content and cascading into unrelated scenarios.
      await browser.execute(() => document.querySelector("#exit-presentation")?.click())
      await browser.waitUntil(async () => !(await browser.execute(() => document.body.classList.contains("presenting-work"))), {
        timeout: 5_000,
        timeoutMsg: "The native presentation exit control did not return to editing"
      })
    }
    await browser.execute(() => {
      if (!globalThis.__elefPresentationKeyCapture) return
      document.removeEventListener("keydown", globalThis.__elefPresentationKeyCapture, true)
      delete globalThis.__elefPresentationKeyCapture
      delete globalThis.__elefPresentationKeyEvents
    })
    if (!(await $("#work-view").isDisplayed())) await this.openWork()
  }

  async renameEditorTitle(title) {
    await $("#desktop-editor-title").setValue(title)
    await browser.keys(Key.Tab)
    this.activeWorkTitle = title
  }

  async waitForEditorTitle(title) {
    await browser.waitUntil(async () =>
      (await $("#desktop-editor-title").getValue()) === title &&
      (await $("#work-title").getText()) === title &&
      (await browser.execute(() => window.__elefSaveTestHooks?.saveStatus())) === "clean", {
      timeout: 10_000,
      timeoutMsg: `The presentation title did not save as ${title}`
    })
  }

  async assertEditorTitle(title) {
    if ((await $("#desktop-editor-title").getValue()) !== title) {
      throw new Error(`The presentation editor did not restore the title ${title}`)
    }
  }

  async replaceSource(source) {
    const sourceMode = await $("#source-mode")
    await sourceMode.waitForDisplayed()
    if ((await sourceMode.getAttribute("aria-pressed")) !== "true") await sourceMode.click()
    await browser.waitUntil(async () => {
      const mode = await $("#desktop-editor-form").getAttribute("data-editor-mode")
      const currentSourceMode = await $("#source-mode")
      return mode === "source" && (await currentSourceMode.getAttribute("aria-pressed")) === "true"
    }, {
      timeout: 5_000,
      timeoutMsg: "The source editor did not finish restoring after the mode switch"
    })
    await this.waitForEditorModeTransition()
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector("#desktop-editor-field")?.editorController?.editingMode === "source"
    ), {
      timeout: 5_000,
      timeoutMsg: "The desktop CodeMirror controller did not enter source mode"
    })
    const editor = await $("#work-source-editor .cm-content")
    await editor.waitForDisplayed()
    // Tauri's embedded WebDriver cannot reliably focus CodeMirror on CI. Use
    // the live controller's input-proxy path so its normal update/input,
    // autosave, preview, and conflict handlers still run.
    const updated = await browser.execute(nextSource => {
      const field = document.querySelector("#desktop-editor-field")
      const controller = field?.editorController
      if (!controller) return false
      const snippetPalette = globalThis.Stimulus?.getControllerForElementAndIdentifier(field, "snippet-palette")
      const mathPalette = globalThis.Stimulus?.getControllerForElementAndIdentifier(field, "math-shortcut-palette")
      // A full-buffer test edit replaces the current authoring context too.
      // End any tab-stop session left by a previous snippet before placing the
      // caret at the new buffer end; the input event refreshes palettes normally.
      snippetPalette?.endStops()
      mathPalette?.endStops()
      controller.replaceRange(nextSource, 0, controller.value.length)
      controller.setSelectionRange(nextSource.length)
      return {
        source: controller.sourceValue,
        selectionStart: controller.selectionStart,
        selectionEnd: controller.selectionEnd,
        editingMode: controller.editingMode
      }
    }, source)
    if (updated?.source !== source || updated.selectionStart !== source.length || updated.selectionEnd !== source.length || updated.editingMode !== "source") {
      throw new Error(`The desktop editor did not accept the shared scenario source at the end of the buffer: ${JSON.stringify(updated)}`)
    }
  }

  async restoreSource(source) {
    const restoredSource = await browser.execute(nextSource => {
      const controller = document.querySelector("#desktop-editor-field")?.editorController
      if (!controller) return null
      controller.replaceRange(nextSource, 0, controller.value.length)
      controller.setSelectionRange(nextSource.length)
      return controller.sourceValue
    }, source)
    // Compare modulo line endings, matching the web helper: a save cycle can legitimately flip LF to CRLF.
    if (restoredSource === null || normalizeLineEndings(restoredSource) !== normalizeLineEndings(source)) {
      throw new Error(`The desktop editor could not restore its original fixture source: ${JSON.stringify(restoredSource)}`)
    }
  }

  async waitForEditorModeTransition() {
    await browser.executeAsync(done => {
      requestAnimationFrame(() => requestAnimationFrame(() => done(true)))
    })
  }

  async readSource() {
    return browser.execute(() => document.querySelector("#desktop-editor-field")?.editorController?.sourceValue ?? "")
  }

  async readStoredSource() {
    const workTitle = this.activeWorkTitle || "E2E seed"
    const sourceFile = workTitle === "E2E document" ? "document.md" : "presentation.md"
    const sourcePath = path.join(process.env.ELEF_E2E_LIBRARY_ROOT, workTitle, sourceFile)
    return readFile(sourcePath, "utf8")
  }

  async setCaretPosition(position) {
    const selection = await browser.execute(offset => {
      const controller = document.querySelector("#desktop-editor-field")?.editorController
      if (!controller) return null
      controller.setSelectionRange(offset)
      return [controller.selectionStart, controller.selectionEnd]
    }, position)
    if (selection?.[0] !== position || selection?.[1] !== position) {
      throw new Error(`The desktop editor could not place its caret at ${position}: ${JSON.stringify(selection)}`)
    }
  }

  async assertBackspaceDeletesEmptyDollarPair(expectedSource) {
    const source = normalizeLineEndings(expectedSource)
    const initialState = await browser.execute(expected => {
      const controller = document.querySelector("#desktop-editor-field")?.editorController
      if (!controller || controller.value !== `${expected}$$`) return null
      controller.setSelectionRange(expected.length + 1)
      controller.focus()
      return { vimEnabled: controller.vimEnabled, insertMode: controller.insertMode }
    }, source)
    if (!initialState) throw new Error("The desktop editor did not contain the empty dollar pair")

    const restoreNormalMode = initialState.vimEnabled && !initialState.insertMode
    try {
      if (restoreNormalMode) {
        focusDesktopWindow()
        typeNativeText("i", { activate: false })
        await browser.waitUntil(async () => browser.execute(() =>
          document.querySelector("#desktop-editor-field")?.editorController?.insertMode === true
        ), {
          timeout: 5_000,
          timeoutMsg: "The desktop editor did not enter Vim insert mode for the Backspace scenario"
        })
      }

      focusDesktopWindow()
      sendNativeKey("Backspace")
      await browser.waitUntil(async () => browser.execute(expected => {
        const controller = document.querySelector("#desktop-editor-field")?.editorController
        return controller?.value === expected
          && controller.selectionStart === expected.length
          && controller.selectionEnd === expected.length
      }, source), {
        timeout: 5_000,
        timeoutMsg: "A real Backspace key did not delete both characters of the empty dollar pair"
      })
    } finally {
      if (restoreNormalMode) {
        sendNativeKey("Escape")
        await browser.waitUntil(async () => browser.execute(() =>
          document.querySelector("#desktop-editor-field")?.editorController?.insertMode === false
        ), {
          timeout: 5_000,
          timeoutMsg: "The desktop editor did not restore Vim normal mode after the Backspace scenario"
        })
      }
    }
  }

  async assertRelativeLineNumbers() {
    const result = await browser.executeAsync(done => {
      const editor = document.querySelector("#desktop-editor-field")?.editorController
      if (!editor) return done({ error: "The shared CodeMirror controller is unavailable" })
      const source = editor.sourceValue
      const selection = editor.view.state.selection.main
      const mode = editor.lineNumberMode
      const vimEnabled = editor.vimEnabled
      const values = () => [...editor.view.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
        .filter(element => element.style.visibility !== "hidden")
        .map(element => element.textContent)
      const twoFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      ;(async () => {
        let outcome
        try {
          editor.loadDocument("One\ntwo\nthree\nfour")
          editor.setSelectionRange(0)
          await twoFrames()
          const firstLineActive = values()
          editor.setSelectionRange(editor.view.state.doc.line(3).from)
          await twoFrames()
          outcome = { mode, vimEnabled, firstLineActive, thirdLineActive: values() }
        } catch (error) {
          outcome = { error: error.message || String(error) }
        } finally {
          editor.loadDocument(source)
          editor.setLineNumberMode(mode)
          editor.view.dispatch({ selection })
          await twoFrames()
        }
        done(outcome)
      })()
    })

    const expected = {
      mode: "relative",
      vimEnabled: true,
      firstLineActive: ["0", "1", "2", "3"],
      thirdLineActive: ["2", "1", "0", "1"]
    }
    const matchesExpectedValues = result && Object.entries(expected).every(([key, value]) =>
      JSON.stringify(result[key]) === JSON.stringify(value)
    )
    if (result?.error || !matchesExpectedValues) {
      throw new Error(`Vim relative line numbers did not track CodeMirror cursor positions: ${JSON.stringify(result)}`)
    }
  }

  async assertDocumentPageAspectRatio() {
    const originalSize = await browser.getWindowSize()
    try {
      for (const mode of ["visual", "source"]) {
        if (mode === "visual") await this.showVisualMode()
        else await this.showSourceMode()

        const frameWidths = []
        for (const size of [{ width: 1280, height: 840 }, { width: 900, height: 600 }]) {
          await browser.setWindowSize(size.width, size.height)
          await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
          const previousWidth = frameWidths.at(-1)
          await browser.waitUntil(async () => browser.execute(() => {
            const frame = document.querySelector("#desktop-preview .document-page-frame")
            if (!frame || document.querySelector("#desktop-preview .document-surface")?.dataset.documentPagesSettled !== "true") return false
            const rect = frame.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          }), {
            timeout: 5_000,
            timeoutMsg: `The document page did not settle at ${size.width}×${size.height}`
          })
          if (previousWidth !== undefined) {
            await browser.waitUntil(async () => browser.execute(width => {
              const frame = document.querySelector("#desktop-preview .document-page-frame")
              return frame && frame.getBoundingClientRect().width < width - 1
            }, previousWidth), {
              timeout: 5_000,
              timeoutMsg: "The source-mode document page did not shrink to the resized preview"
            })
          }
          const metrics = await browser.execute(() => {
            const frame = document.querySelector("#desktop-preview .document-page-frame")
            const rect = frame.getBoundingClientRect()
            const preview = frame.closest(".preview-pane")
            return {
              width: rect.width,
              ratio: rect.width / rect.height,
              fitsPreviewWidth: !preview || rect.width <= preview.clientWidth + 1
            }
          })
          if (Math.abs(metrics.ratio - 210 / 297) >= 0.005 || !metrics.fitsPreviewWidth) {
            throw new Error(`Document page left its A4 preview bounds at ${metrics.ratio} in ${mode} mode at ${size.width}×${size.height}`)
          }
          frameWidths.push(metrics.width)
        }
        if (frameWidths[1] >= frameWidths[0] - 1) {
          throw new Error(`The document page did not shrink with the available width in ${mode} mode: ${frameWidths.join("px → ")}px`)
        }
      }
    } finally {
      await browser.setWindowSize(originalSize.width, originalSize.height)
    }
  }

  async assertCaretPosition(position) {
    await browser.waitUntil(async () => browser.execute(offset => {
      const controller = document.querySelector("#desktop-editor-field")?.editorController
      return controller?.selectionStart === offset && controller?.selectionEnd === offset
    }, position), {
      timeout: 5_000,
      timeoutMsg: `The desktop editor did not restore its caret to source offset ${position}`
    })
  }

  async captureCaretAutofocusShot(name) {
    // Evidence-only: a screenshot driver that cannot capture must never fail the suite.
    try {
      await mkdir("test-results/caret-autofocus", { recursive: true })
      await browser.saveScreenshot(`test-results/caret-autofocus/${name}.png`)
    } catch (_error) { /* evidence-only */ }
  }

  async assertSourceCaretAtStartOnOpen() {
    // Parity with a fresh open: the Source caret sits at position 0 and the
    // editor holds DOM focus, so typing and Vim navigation work immediately.
    // This mirrors the focus precondition every native-typing scenario
    // establishes before sending keys (view.hasFocus with contentDOM active).
    await browser.waitUntil(async () => browser.execute(() => {
      const editor = document.querySelector("#desktop-editor-field")?.editorController
      return editor?.selectionStart === 0 && editor?.selectionEnd === 0
        && editor.view.hasFocus === true
        && document.activeElement === editor.view.contentDOM
    }), {
      timeout: 5_000,
      timeoutMsg: "The desktop editor did not open with its caret at source offset 0 and focused"
    })
  }

  async assertCaretAtStartOnOpen() {
    const mode = await $("#desktop-editor-form").getAttribute("data-editor-mode")
    if (mode === "source") return this.assertSourceCaretAtStartOnOpen()
    await browser.waitUntil(async () => browser.execute(() => {
      const first = document.querySelector("#desktop-preview [data-editor-block-id][contenteditable='true']")
      const selection = window.getSelection()
      if (!first || document.activeElement !== first || !selection?.isCollapsed
          || !selection.focusNode || !first.contains(selection.focusNode)) return false
      const prefix = document.createRange()
      prefix.selectNodeContents(first)
      prefix.setEnd(selection.focusNode, selection.focusOffset)
      return prefix.toString().length === 0
    }), {
      timeout: 5_000,
      timeoutMsg: "The visual editor did not open with its caret in the first rendered passage"
    })
  }

  async typeEmptyDisplayMath(mode) {
    await browser.execute(() => window.focus())
    focusDesktopWindow()
    let target
    if (mode === "visual") {
      target = await $("#desktop-preview .document-editor-block[data-editor-empty-block='true'][contenteditable='true']")
      await target.waitForDisplayed()
      await target.click()
      const focus = await browser.execute(() => {
        const block = document.querySelector("#desktop-preview .document-editor-block[data-editor-empty-block='true']")
        block?.focus({ preventScroll: true })
        const selection = window.getSelection()
        return {
          active: document.activeElement === block,
          selectionInsideBlock: Boolean(selection?.focusNode && block?.contains(selection.focusNode))
        }
      })
      if (!focus?.active || !focus.selectionInsideBlock) {
        throw new Error(`The visual editor did not receive focus before native typing: ${JSON.stringify(focus)}`)
      }
    } else {
      target = await $("#work-source-editor .cm-content")
      await target.waitForDisplayed()
      const focus = await browser.execute(() => {
        const editor = document.querySelector("#desktop-editor-field")?.editorController
        editor?.view.focus()
        return {
          editorHasFocus: Boolean(editor?.view.hasFocus),
          contentDomActive: document.activeElement === editor?.view.contentDOM,
          selectionStart: editor?.selectionStart,
          valueLength: editor?.value.length
        }
      })
      if (!focus?.editorHasFocus || !focus.contentDomActive) {
        throw new Error(`CodeMirror did not receive focus before native typing: ${JSON.stringify(focus)}`)
      }
      if (focus.selectionStart !== focus.valueLength) {
        throw new Error(`CodeMirror did not retain the end-of-source caret before native typing: ${JSON.stringify(focus)}`)
      }
      const vimState = await browser.execute(() => {
        const editor = document.querySelector("#desktop-editor-field")?.editorController
        return {
          enabled: editor?.vimEnabled === true,
          insertMode: editor?.vimMode?.startsWith("insert") === true
        }
      })
      if (vimState.enabled && !vimState.insertMode) {
        typeNativeText("i", { activate: false })
        await browser.waitUntil(async () => browser.execute(() =>
          document.querySelector("#desktop-editor-field")?.editorController?.vimMode?.startsWith("insert") === true
        ), {
          timeout: 5_000,
          timeoutMsg: "The source editor did not enter Vim insert mode before display-math input"
        })
      }
    }

    await browser.execute(mode => {
      const events = []
      const editor = mode === "source"
        ? document.querySelector("#desktop-editor-field .cm-content")
        : document.querySelector("#desktop-preview .document-editor-block[data-editor-empty-block='true']")
      const handler = event => events.push({
        key: event.key,
        trusted: event.isTrusted,
        inEditor: Boolean(editor && (event.target === editor || editor.contains(event.target)))
      })
      document.addEventListener("keydown", handler, true)
      window.__elefDisplayMathKeys = { events, handler }
    }, mode)
    const expectedKeys = ["$", "$", "Enter"]
    let keys
    let keyWaitError = null
    try {
      typeNativeText("$")
      typeNativeText("$")
      sendNativeKey("Enter", { activate: false })
      try {
        await browser.waitUntil(async () => {
          const inputKeys = await browser.execute(() =>
            (window.__elefDisplayMathKeys?.events || [])
              .filter(({ key }) => key !== "Shift")
              .map(({ key }) => key)
          )
          return JSON.stringify(inputKeys) === JSON.stringify(expectedKeys)
        }, {
          timeout: 2_000,
          interval: 50,
          timeoutMsg: "The native Enter key event did not reach the display-math editor"
        })
      } catch (error) {
        keyWaitError = error.message
      }
    } finally {
      keys = await browser.execute(() => {
        const capture = window.__elefDisplayMathKeys
        document.removeEventListener("keydown", capture?.handler, true)
        delete window.__elefDisplayMathKeys
        return capture?.events || []
      })
    }
    const inputKeys = keys.filter(({ key }) => key !== "Shift")
    if (JSON.stringify(inputKeys.map(({ key }) => key)) !== JSON.stringify(expectedKeys) ||
      keys.some(({ trusted, inEditor }) => !trusted || !inEditor)) {
      const waitDiagnostic = keyWaitError ? `; event wait: ${keyWaitError}` : ""
      throw new Error(`Display-math input did not reach the editor as the expected trusted keys: ${JSON.stringify(keys)}${waitDiagnostic}`)
    }
  }

  async assertDisplayMathCaret(expectedSource, expectedCaret, mode) {
    const visual = mode === "visual"
    let actualState
    try {
      await browser.waitUntil(async () => {
        actualState = await browser.execute(() => {
          const form = document.querySelector("#desktop-editor-form")
          const editor = document.querySelector("#desktop-editor-field")?.editorController
          const selection = window.getSelection()
          const focusElement = selection?.focusNode?.nodeType === Node.ELEMENT_NODE
            ? selection.focusNode
            : selection?.focusNode?.parentElement
          const activeMath = focusElement?.closest?.(".editor-math-active")
          return {
            mode: editor?.editingMode,
            value: editor?.value,
            selectionStart: editor?.selectionStart,
            selectionEnd: editor?.selectionEnd,
            previewSource: form?.previewController?.pendingProjection?.source || null,
            activeMathText: activeMath?.textContent || null,
            visualOffset: selection?.focusOffset ?? null
          }
        })
        return actualState?.mode === mode && actualState.value === expectedSource &&
          actualState.selectionStart === expectedCaret && actualState.selectionEnd === expectedCaret &&
          (!visual || (actualState.previewSource === expectedSource && actualState.activeMathText === "$$\n\n$$" && actualState.visualOffset === 3))
      }, {
        timeout: 10_000,
        timeoutMsg: `The desktop ${mode} editor did not keep the caret on the empty display-math body line`
      })
    } catch (error) {
      throw new Error(`${error.message}; actual state: ${JSON.stringify(actualState)}`)
    }
  }

  async assertModeSwitchRespectsNewCaret() {
    const result = await browser.execute(async () => {
      const editor = document.querySelector("#desktop-editor-field").editorController
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
    if (result.actual !== result.intended) throw new Error(`The mode-switch callback overwrote the new caret: ${JSON.stringify(result)}`)
  }

  async waitForSource(source) {
    try {
      await browser.waitUntil(async () => await this.readSource() === source, {
        timeout: 10_000,
        timeoutMsg: "The desktop editor buffer did not reach the expected source"
      })
    } catch (error) {
      const state = await browser.execute(() => {
        const field = document.querySelector("#desktop-editor-field")
        const editor = field?.editorController
        const palette = globalThis.Stimulus?.getControllerForElementAndIdentifier(field, "snippet-palette")
        return {
          source: editor?.sourceValue,
          selection: [editor?.selectionStart, editor?.selectionEnd],
          mode: editor?.editingMode,
          paletteQuery: palette?.query,
          paletteMatches: palette?.matches?.map(entry => entry.name || entry.snippet?.name),
          paletteHidden: document.querySelector('[aria-label="Snippet suggestions"]')?.hidden
        }
      }).catch(diagnosticError => ({ diagnosticError: diagnosticError.message }))
      throw new Error(`${error.message}; desktop editor state: ${JSON.stringify(state)}`)
    }
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
      const workTitle = this.activeWorkTitle || "E2E seed"
      const sourceFile = workTitle === "E2E document" ? "document.md" : "presentation.md"
      const sourcePath = path.join(process.env.ELEF_E2E_LIBRARY_ROOT, workTitle, sourceFile)
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
            saveStatus: window.__elefSaveTestHooks?.saveStatus?.() || "<missing>",
            status: document.querySelector("#status-text")?.textContent || "<missing>",
            notice: document.querySelector("#notice")?.textContent || "",
            workId: document.querySelector("#work-id")?.textContent || "",
            workTitle: document.querySelector("#work-title")?.textContent || ""
          }))
        ])
        throw new Error(`${error.message}; desktop state: ${JSON.stringify(state)}; disk source: ${JSON.stringify(diskSource)}`)
      })
    }
    {
      const trace = []
      const deadline = Date.now() + 10_000
      for (;;) {
        const sample = await browser.execute(() => {
          let saveStatus
          try { saveStatus = window.__elefSaveTestHooks?.saveStatus?.() ?? "<missing>" } catch (hookError) { saveStatus = `THREW:${hookError.message}` }
          return {
            saveStatus,
            status: document.querySelector("#status-text")?.textContent || "<missing>",
            notice: (document.querySelector("#notice")?.textContent || "").slice(0, 120)
          }
        }).catch(execError => ({ saveStatus: `EXECFAIL:${execError.message}`, status: "?", notice: "" }))
        const prev = trace[trace.length - 1]
        if (!prev || prev.s !== sample.saveStatus || prev.t !== sample.status) {
          trace.push({ at: Date.now(), s: sample.saveStatus, t: sample.status, n: sample.notice })
        }
        if (sample.saveStatus === "clean") break
        if (Date.now() >= deadline) {
          const dom = await browser.execute(() => ({
            workId: document.querySelector("#work-id")?.textContent || "",
            workTitle: document.querySelector("#work-title")?.textContent || "",
            titleInput: document.querySelector("#desktop-editor-title")?.value ?? "<no-input>",
            dialogs: [...document.querySelectorAll("dialog")].map(d => ({ id: d.id || "<noid>", open: d.open, text: (d.textContent || "").slice(0, 160) })),
            libraryHidden: document.querySelector("#library-view")?.hidden ?? "<missing>",
            workViewHidden: document.querySelector("#work-view")?.hidden ?? "<missing>",
            editorMode: document.querySelector("#desktop-editor-form")?.dataset.editorMode || "",
            loadedWorkId: document.querySelector("#desktop-editor-form")?.dataset.loadedWorkId || "",
            controllerErrors: window.__elefE2EControllerErrors?.slice(-5) || []
          })).catch(diagError => ({ diagnosticError: diagError.message }))
          throw new Error(`The desktop editor did not finish saving; STATUS-TRACE: ${JSON.stringify(trace)}; DOM: ${JSON.stringify(dom)}`)
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }
  }

  async showVisualMode() {
    const visualButton = await $("#visual-mode")
    try {
      await visualButton.waitForEnabled()
    } catch (error) {
      const diagnostic = await browser.execute(() => {
        const form = document.querySelector("#desktop-editor-form")
        const field = document.querySelector("#desktop-editor-field")
        const preview = document.querySelector("#desktop-preview")
        const application = window.Stimulus
        return {
          buttonTitle: document.querySelector("#visual-mode")?.title || "",
          previewUrl: form?.previewController?.urlValue || form?.dataset.previewUrlValue || "",
          status: document.querySelector("#status-text")?.textContent || "",
          saveStatus: window.__elefSaveTestHooks?.saveStatus?.() || "",
          previewStatus: form?.querySelector("[data-preview-target='status']")?.textContent || "",
          previewWarnings: [...(form?.querySelectorAll(".preview-warnings li") || [])].map((item) => item.textContent),
          previewText: preview?.textContent || "",
          previewControllerConnected: Boolean(form && application?.getControllerForElementAndIdentifier?.(form, "preview")),
          editorControllerConnected: Boolean(field && application?.getControllerForElementAndIdentifier?.(field, "editor")),
          editorControllerReady: field?.editorController?.editorReady ?? null,
          editorControllerRegistered: Boolean(application?.router?.modulesByIdentifier?.has("editor")),
          mountedEditor: Boolean(field?.querySelector(".cm-editor")),
          previewTrace: window.__elefPreviewTrace?.slice(-12) || [],
          controllerErrors: window.__elefE2EControllerErrors?.slice(-8) || []
        }
      })
      throw new Error(`${error.message}; visual preview diagnostic: ${JSON.stringify(diagnostic)}`)
    }
    await visualButton.click()
    await browser.waitUntil(async () => {
      const mode = await $("#desktop-editor-form").getAttribute("data-editor-mode")
      return mode === "visual"
    }, {
      timeout: 5_000,
      timeoutMsg: "The visual-mode control did not activate the visual editor"
    })
  }

  async assertDocumentLinkPreview(title) {
    const link = await $("#desktop-preview a.document-link")
    await link.waitForDisplayed({ timeout: 5_000 })
    if ((await link.getText()).trim() !== title) {
      throw new Error(`The desktop preview did not resolve the document link to ${title}`)
    }
    const expectedDocumentId = process.env.ELEF_E2E_DESKTOP_LINKED_DOCUMENT_ID
    if (!expectedDocumentId) throw new Error("The desktop linked-document fixture ID is unavailable")
    if ((await link.getAttribute("href")) !== `#work/${expectedDocumentId}`) {
      throw new Error(`The desktop preview did not link ${title} to the expected document ID`)
    }
  }

  async refreshPreview() {
    const result = await browser.executeAsync(done => {
      const controller = document.querySelector("#desktop-editor-form")?.previewController
      if (!controller) return done({ error: "The desktop preview controller is unavailable" })
      const wasRunning = Boolean(controller.requestController)
      controller.refresh().then(rendered => done({
        rendered: rendered === true,
        queued: wasRunning && rendered === false
      }), error => done({ error: error.message }))
    })
    if (result?.error) throw new Error(result.error)
    if (!result?.rendered && !result?.queued) throw new Error("The desktop preview did not render or queue the latest saved source")
    await browser.waitUntil(async () => browser.execute(() => {
      const form = document.querySelector("#desktop-editor-form")
      return Boolean(form && form.dataset.previewProjectionStale !== "true")
    }), {
      timeout: 20_000,
      interval: 50,
      timeoutMsg: "The desktop preview did not render the latest saved source"
    })
  }

  async showSourceMode() {
    const sourceMode = await $("#source-mode")
    await sourceMode.waitForDisplayed()
    if ((await $("#desktop-editor-form").getAttribute("data-editor-mode")) !== "source") await sourceMode.click()
    await browser.waitUntil(async () => (await $("#desktop-editor-form").getAttribute("data-editor-mode")) === "source", {
      timeout: 5_000,
      timeoutMsg: "The source editor did not activate after checking the rendered document link"
    })
    await this.waitForEditorModeTransition()
  }

  async assertSourceEditorUsable() {
    const metrics = await browser.execute(() => {
      const field = document.querySelector("#desktop-editor-field")
      const controller = field?.editorController
      const editor = field?.querySelector(".cm-editor")
      const content = field?.querySelector(".cm-content")
      const scroller = field?.querySelector(".cm-scroller")
      const projection = document.querySelector("#desktop-preview")
      const rect = editor?.getBoundingClientRect()
      const style = content ? getComputedStyle(content) : null
      return {
        ready: Boolean(controller?.editorReady && controller.view?.state?.doc),
        mode: document.querySelector("#desktop-editor-form")?.dataset.editorMode,
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
      throw new Error(`The Tauri source editor layout or CodeMirror state is unusable: ${JSON.stringify(metrics)}`)
    }
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
          saveStatus: window.__elefSaveTestHooks?.saveStatus?.(),
          previewStatus: document.querySelector("[data-preview-target='status']")?.textContent,
          preview: document.querySelector("#desktop-preview")?.innerText,
          warnings: document.querySelector("[data-preview-target='warnings']")?.innerText,
          stale: form?.dataset.previewProjectionStale || null
        }
      })
      throw new Error(`${error.message}; desktop state: ${JSON.stringify(state)}`)
    }
  }

  async waitForArtRoots(count) {
    await browser.waitUntil(async () => (await $$("#desktop-preview [data-elef-art-root]")).length === count, {
      timeout: 10_000,
      timeoutMsg: `The desktop preview did not render ${count} Art roots`
    })
  }

  async assertRichRenderingMedia() {
    await browser.waitUntil(async () => browser.execute(() => {
      const preview = document.querySelector("#desktop-preview")
      const image = [...(preview?.querySelectorAll("img") || [])]
        .some(candidate => candidate.complete && candidate.naturalWidth > 0)
      return Boolean(
        preview?.querySelector(".slides-theme-dark.slides-typography-technical") &&
        preview.querySelectorAll(".katex").length >= 2 &&
        preview.querySelector("pre.mermaid svg") &&
        preview.querySelectorAll("[data-elef-art-root]").length === 1 &&
        image
      )
    }), {
      timeout: 15_000,
      timeoutMsg: "The rich release fixture did not render its theme, math, Mermaid, Art, and local image"
    })
  }

  async readArtSemantics() {
    return browser.execute(() => [...document.querySelectorAll("#desktop-preview [data-elef-art-root]")].map(root => {
      const list = root.querySelector(":scope > .elef-art-list")
      const items = [...(list?.children || [])]
      return {
        mode: root.dataset.artMode,
        density: root.dataset.artDensity,
        status: root.dataset.artStatus,
        layout: root.dataset.artLayout,
        rootTag: list?.tagName,
        itemCount: items.length,
        itemText: items.map(item => {
          const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
          const parts = []
          while (walker.nextNode()) {
            const text = walker.currentNode.textContent.trim()
            if (text) parts.push(text)
          }
          return parts.join(" ").replace(/\s+/g, " ").trim()
        }),
        nestedListTag: items[0]?.querySelector(":scope > ol, :scope > ul")?.tagName || null,
        start: list?.hasAttribute("start") ? list.getAttribute("start") : null,
        blockClass: root.closest(".slide-block")?.className || ""
      }
    }))
  }

  async inspectHostilePreview() {
    return browser.execute(() => {
      const preview = document.querySelector("#desktop-preview")
      const elements = [...(preview?.querySelectorAll("*") || [])]
      const links = [...(preview?.querySelectorAll("a[href]") || [])]
      const media = [...(preview?.querySelectorAll("img[src], video[src]") || [])]
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

  async waitForAuthoringOption(palette, name) {
    const label = palette === "snippet"
      ? "Snippet suggestions"
      : palette === "document-link" ? "Document link suggestions" : "Math shortcut suggestions"
    if (palette === "document-link") {
      const visible = await browser.execute(({ label, name }) => {
        const field = document.querySelector("#desktop-editor-field")
        const controller = globalThis.Stimulus?.getControllerForElementAndIdentifier(field, "document-link-palette")
        const listbox = [...(field?.querySelectorAll('[role="listbox"]') || [])]
          .find(element => element.getAttribute("aria-label") === label)
        const option = [...(listbox?.querySelectorAll('[role="option"]') || [])]
          .find(element => element.textContent.includes(name))
        return Boolean(controller && listbox && !listbox.hidden && controller.matches.includes(name) && option)
      }, { label, name })
      if (!visible) throw new Error(`The document-link palette did not show ${name}`)
      return
    }
    const controllerId = palette === "snippet" ? "snippet-palette" : "math-shortcut-palette"
    const inspect = async () => browser.execute(({ label, name, palette, controllerId }) => {
      const field = document.querySelector("#desktop-editor-field")
      const editor = field?.editorController
      const controller = globalThis.Stimulus?.getControllerForElementAndIdentifier(field, controllerId)
      const listbox = [...(field?.querySelectorAll('[role="listbox"]') || [])]
        .find(element => element.getAttribute("aria-label") === label)
      const option = [...(listbox?.querySelectorAll('[role="option"]') || [])]
        .find(element => element.textContent.includes(name))
      const currentQuery = controller?.queryAtCaret?.()
      const paletteQuery = palette === "snippet"
        ? { prefix: controller?.queryPrefix, text: controller?.query, start: controller?.queryStart }
        : controller?.query
      const sourceLength = editor?.sourceValue.length ?? -1
      const ready = Boolean(
        editor && listbox && !listbox.hidden && option && currentQuery && paletteQuery
          && currentQuery.prefix === paletteQuery.prefix
          && currentQuery.text === paletteQuery.text
          && currentQuery.start === paletteQuery.start
          && editor.selectionStart === sourceLength
          && editor.selectionEnd === sourceLength
      )
      return {
        ready,
        visible: listbox ? !listbox.hidden : false,
        option: option?.textContent || null,
        currentQuery,
        paletteQuery,
        selection: [editor?.selectionStart, editor?.selectionEnd],
        sourceLength
      }
    }, { label, name, palette, controllerId })
    try {
      await browser.waitUntil(async () => (await inspect()).ready, {
        timeout: 5_000,
        timeoutMsg: `The ${palette} palette did not show ${name}`
      })
    } catch (error) {
      const state = await inspect().catch(diagnosticError => ({ diagnosticError: diagnosticError.message }))
      throw new Error(`${error.message}; desktop palette state: ${JSON.stringify(state)}`)
    }
  }

  async selectAuthoringOption(palette, name) {
    const label = palette === "snippet"
      ? "Snippet suggestions"
      : palette === "document-link" ? "Document link suggestions" : "Math shortcut suggestions"
    await this.waitForAuthoringOption(palette, name)
    const selected = await browser.execute(({ label, name, palette }) => {
      const field = document.querySelector("#desktop-editor-field")
      const editor = field?.editorController
      const listbox = [...document.querySelectorAll('.source-field [role="listbox"]')]
        .find(element => element.getAttribute("aria-label") === label)
      const item = [...(listbox?.querySelectorAll('[role="option"]') || [])]
        .find(element => element.textContent.includes(name))
      if (!editor || !listbox || listbox.hidden || !item) return false
      const sourceBefore = editor.sourceValue
      if (palette !== "document-link") editor.setSelectionRange(sourceBefore.length)
      item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }))
      return editor.sourceValue !== sourceBefore && listbox.hidden
    }, { label, name, palette })
    if (!selected) throw new Error(`The ${palette} palette did not insert ${name} into the editor source`)
  }

  async refreshDocumentLinkPalette() {
    const visible = await browser.execute(() => {
      const field = document.querySelector("#desktop-editor-field")
      const controller = globalThis.Stimulus?.getControllerForElementAndIdentifier(field, "document-link-palette")
      if (!controller) return false
      controller.refresh()
      return !controller.paletteTarget.hidden
    })
    if (!visible) throw new Error("The document-link palette did not open")
  }

  async editVisualText(currentText, replacementText) {
    const edited = await browser.execute(({ currentText, replacementText }) => {
      const block = [...document.querySelectorAll("#desktop-preview .slide-block")]
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
    if (!edited) throw new Error(`The desktop visual editor did not accept the text ${JSON.stringify(currentText)}`)
  }

  async writeExternalSource(source) {
    await writeFile(path.join(process.env.ELEF_E2E_LIBRARY_ROOT, CONFLICT_WORK_NAME, CONFLICT_SOURCE_FILE), source)
  }

  async waitForConflict() {
    await $("#conflict-dialog").waitForDisplayed({ timeout: 10_000 })
  }

  async assertConflict(localSource, externalSource) {
    const local = await $("#conflict-local").getText()
    const disk = await $("#conflict-disk").getText()
    const editor = await this.readSource()
    if (!local.includes(localSource.trim()) || !disk.includes(externalSource.trim()) || editor !== localSource) {
      throw new Error(`Conflict dialog did not preserve both versions and the editor buffer: ${JSON.stringify({ local, disk, editor })}`)
    }
  }

  async useDiskVersion() {
    await $("#use-disk-version").click()
    await $("#conflict-dialog").waitForDisplayed({ reverse: true })
  }

  async keepLocalVersion() {
    await $("#keep-local-version").click()
    await $("#conflict-dialog").waitForDisplayed({ reverse: true })
  }

  async editMergedSource(source) {
    await $("#conflict-merge").setValue(source)
  }

  async saveMergedVersion() {
    await $("#save-merged-version").click()
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

  async rejectMediaFile({ filename, mimeType, contents, size }) {
    const result = await browser.execute(async ({ filename, mimeType, contents, size }) => {
      const field = document.querySelector("#desktop-editor-field")
      const controller = field?.editorController
      const form = document.querySelector("#desktop-editor-form")
      const input = document.querySelector('input[data-media-target="input"]')
      const media = form && globalThis.Stimulus?.getControllerForElementAndIdentifier(form, "media")
      if (!controller || !media || !input || typeof DataTransfer !== "function") {
        return { error: "media controls were not ready" }
      }

      const sourceBefore = controller.sourceValue
      const bytes = size === undefined
        ? new TextEncoder().encode(contents)
        : new Uint8Array(size)
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], filename, { type: mimeType }))
      input.files = transfer.files
      if (input.files.length !== 1) return { error: "WebKit did not accept the media fixture" }

      await media.selected()
      return {
        sourceBefore,
        sourceAfter: controller.sourceValue,
        status: form.querySelector('[data-media-target="status"]')?.textContent || ""
      }
    }, { filename, mimeType, contents, size })

    if (result.error) throw new Error(`The desktop media controller could not run the rejection case: ${result.error}`)
    if (result.sourceAfter !== result.sourceBefore) {
      throw new Error(`Rejected media changed the Markdown source: ${JSON.stringify(result)}`)
    }
    return result.status
  }

  async waitForImage(digest) {
    try {
      await browser.waitUntil(async () => browser.execute(expectedDigest =>
        [...document.querySelectorAll('img[data-editor-image-source="true"]')].some(image =>
          image.src.includes(expectedDigest) && image.complete && image.naturalWidth > 0
        ), digest), {
        timeout: 10_000,
        timeoutMsg: "The desktop asset protocol did not render the uploaded image"
      })
    } catch (error) {
      const diagnostic = await browser.execute(() => {
        const form = document.querySelector("#desktop-editor-form")
        const field = document.querySelector("#desktop-editor-field")
        const preview = document.querySelector("#desktop-preview")
        return {
          mode: form?.dataset.editorMode,
          source: field?.editorController?.sourceValue,
          previewStatus: document.querySelector("[data-preview-target='status']")?.textContent,
          previewWarnings: document.querySelector("[data-preview-target='warnings']")?.textContent,
          previewHtml: preview?.innerHTML.slice(0, 3000),
          images: [...(preview?.querySelectorAll("img") || [])].map(image => ({
            srcAttribute: image.getAttribute("src"),
            src: image.src,
            currentSrc: image.currentSrc,
            editorImage: image.getAttribute("data-editor-image-source"),
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight
          }))
        }
      })
      const files = await readdir(path.join(process.env.ELEF_E2E_LIBRARY_ROOT, "E2E seed", "images"))
        .catch(readError => [`<${readError.code || "read_error"}>`])
      throw new Error(`${error.message}; image files: ${JSON.stringify(files)}; preview diagnostic: ${JSON.stringify(diagnostic)}`)
    }
  }
}

class DesktopLibraryUi {
  async createWork(title, kind) {
    await this.openLibrary()
    await $(".new-work-trigger").click()
    await $(`[data-new-work-kind="${kind}"]`).click()
    // Direct-open parity with the web menu: the click creates with a unique
    // default title and lands in the editor. Name the work through the
    // editor so shared scenarios keep deterministic titles.
    await $("#work-view").waitForDisplayed()
    const editor = new DesktopEditorUi()
    if (kind === "document") {
      // A document's library title is its folder name, which only the card
      // rename changes; the editor source carries the H1 separately. Set
      // the H1 first, then rename the folder to match. New works seed the
      // default front matter, so the retitle preserves it.
      const defaultTitle = await browser.execute(
        () => document.querySelector("#work-title")?.textContent.trim()
      )
      await editor.replaceSource(`---\ntheme: match\n---\n# ${title}\n\n`)
      await editor.waitForSource(`---\ntheme: match\n---\n# ${title}\n\n`)
      await browser.waitUntil(async () => browser.execute(
        () => window.__elefSaveTestHooks?.saveStatus() === "clean"
      ), {
        timeout: 10_000,
        timeoutMsg: `The retitled ${kind} source did not finish saving`
      })
      await this.openLibrary()
      await this.renameWork(defaultTitle, title)
      // The card list renders the rename optimistically: force a server
      // round-trip so the open below reads the persisted folder name.
      await $("#refresh-library").click()
      await browser.waitUntil(async () => (await $(`[aria-label='Edit ${title}']`).isDisplayed()), {
        timeout: 10_000,
        timeoutMsg: `The renamed ${title} work did not survive a library refresh`
      })
      await editor.openWork(title)
    } else {
      await editor.renameEditorTitle(title)
      await editor.waitForEditorTitle(title)
    }
    await browser.waitUntil(async () => browser.execute(({ expected, documentKind }) => {
      if (documentKind) return document.querySelector("#work-title")?.textContent.trim() === expected
      return document.querySelector("#desktop-editor-title")?.value === expected
    }, { expected: title, documentKind: kind === "document" }), {
      timeout: 10_000,
      timeoutMsg: `The newly created ${kind} did not open in the editor`
    })
  }

  async assertCreatedWork(title, kind) {
    await $("#work-view").waitForDisplayed()
    const result = await browser.execute(({ expected, documentKind }) => ({
      title: documentKind
        ? document.querySelector("#work-title")?.textContent.trim()
        : document.querySelector("#desktop-editor-title")?.value,
      source: document.querySelector("#desktop-editor-field")?.editorController?.sourceValue
    }), { expected: title, documentKind: kind === "document" })
    if (result.title !== title || (kind === "document" && result.source !== `---\ntheme: match\n---\n# ${title}\n\n`)) {
      throw new Error(`The editor did not open the new ${kind} with its expected content: ${JSON.stringify(result)}`)
    }
  }

  async assertWorkVisible(title) {
    await this.openLibrary()
    await $("#show-work-list").click()
    await $(`[aria-label='Edit ${title}']`).waitForDisplayed()
  }

  async deleteWork(title) {
    await this.openLibrary()
    await $("#show-work-list").click()
    let card
    for (const candidate of await $$(".library-card")) {
      if (await candidate.$(".library-card-title").getText() === title) card = candidate
    }
    if (!card) throw new Error(`The ${title} library card was missing`)
    const menu = await card.$(".library-card-menu-trigger")
    await menu.click()
    await card.$(".library-card-menu-options .is-danger").click()
    if (process.platform === "darwin") {
      answerMacNativeDialog("OK")
    } else if (process.platform === "linux") {
      const dialogId = execFileSync("xdotool", ["search", "--sync", "--onlyvisible", "--name", "^Move Work to Trash$"], {
        encoding: "utf8", timeout: 15_000
      }).trim().split(/\s+/).at(-1)
      execFileSync("xdotool", ["windowactivate", "--sync", dialogId], { timeout: 5_000 })
      execFileSync("xdotool", ["key", "--clearmodifiers", "alt+o"], { timeout: 5_000 })
    } else {
      throw new Error(`Native delete confirmation is unsupported on ${process.platform}`)
    }
    await browser.waitUntil(async () => !(await $(`[aria-label='Edit ${title}']`).isExisting()), {
      timeout: 10_000,
      timeoutMsg: `The deleted ${title} remained in the library`
    })
  }

  async assertWorkAbsent(title) {
    await this.openLibrary()
    await $("#show-work-list").click()
    if (await $(`[aria-label='Edit ${title}']`).isExisting()) {
      throw new Error(`The library still shows deleted work ${title}`)
    }
  }

  async previewWork(title) {
    await this.openLibrary()
    await $("#show-work-list").click()
    await $(`[aria-label='Preview ${title}']`).click()
    await browser.waitUntil(async () => browser.execute(expected => {
      const editor = document.querySelector("#desktop-editor-title")
      const form = document.querySelector("#desktop-editor-form")
      return editor?.value === expected && form?.dataset.editorMode === "visual" &&
        !document.querySelector("#work-view")?.hidden && Boolean(form?.dataset.loadedWorkId)
    }, title), {
      timeout: 10_000,
      timeoutMsg: `The ${title} card preview did not open its rendered Visual editor`
    })
    await this.openLibrary()
  }

  async presentWork(title) {
    await this.openLibrary()
    await $("#show-work-list").click()
    const started = await browser.execute(expected => {
      const card = [...document.querySelectorAll(".library-card")]
        .find(candidate => candidate.querySelector(".library-card-title")?.textContent.trim() === expected)
      const button = [...(card?.querySelectorAll(".library-card-menu-options button") || [])]
        .find(candidate => candidate.textContent.trim() === "Present")
      button?.click()
      return Boolean(button)
    }, title)
    if (!started) throw new Error(`The ${title} library card has no Present action`)
    try {
      await browser.waitUntil(async () => browser.execute(() => document.body.classList.contains("presenting-work")), {
        timeout: 10_000,
        timeoutMsg: `The ${title} library card did not start presentation mode`
      })
      await browser.waitUntil(desktopWindowIsFullscreen, {
        timeout: 10_000,
        timeoutMsg: `The ${title} presentation did not enter native fullscreen`
      })
    } finally {
      if (await browser.execute(() => document.body.classList.contains("presenting-work"))) {
        await $("#exit-presentation").click()
        await browser.waitUntil(async () => browser.execute(() => !document.body.classList.contains("presenting-work")), {
          timeout: 5_000,
          timeoutMsg: "The native presentation did not return to editing"
        })
      }
      await browser.waitUntil(async () => !(await desktopWindowIsFullscreen()), {
        timeout: 10_000,
        timeoutMsg: "The native window did not exit fullscreen after presentation"
      })
    }
    await this.openLibrary()
  }

  async openWork(title) {
    await this.openLibrary()
    await $("#show-work-list").click()
    await $(`[aria-label='Edit ${title}']`).click()
    await browser.waitUntil(async () => browser.execute(expected => {
      const editor = document.querySelector("#desktop-editor-title")
      const form = document.querySelector("#desktop-editor-form")
      return editor?.value === expected && !document.querySelector("#work-view")?.hidden && Boolean(form?.dataset.loadedWorkId)
    }, title), {
      timeout: 10_000,
      timeoutMsg: `The ${title} work did not open from its library card`
    })
  }

  async showSourceMode() {
    const source = await $("#source-mode")
    if ((await source.getAttribute("aria-pressed")) !== "true") await source.click()
    await browser.waitUntil(async () => (await $("#desktop-editor-form").getAttribute("data-editor-mode")) === "source", {
      timeout: 5_000,
      timeoutMsg: "The desktop source editor did not activate"
    })
  }

  async assertVisualMode() {
    await browser.waitUntil(async () => (await $("#desktop-editor-form").getAttribute("data-editor-mode")) === "visual", {
      timeout: 5_000,
      timeoutMsg: "Opening a work from the library did not return to Rails' default Visual mode"
    })
  }

  async renameWork(title, newTitle) {
    let card
    for (const candidate of await $$(".library-card")) {
      if (await candidate.$(".library-card-title").getText() === title) card = candidate
    }
    if (!card) throw new Error(`The ${title} library card was missing`)
    await card.$(".library-card-menu-trigger").click()
    await card.$(".rename-menu > summary").click()
    await card.$(".library-rename input[type='text']").setValue(newTitle)
    await card.$(".library-rename button").click()
    await browser.waitUntil(async () => (await $(`[aria-label='Edit ${newTitle}']`).isDisplayed()), {
      timeout: 10_000, timeoutMsg: `The library did not show the renamed ${newTitle} work`
    })
    if (await $(`[aria-label='Edit ${title}']`).isExisting()) throw new Error("The old work name remained after rename")
  }

  async openLibrary() {
    if (!(await $("#library-view").isDisplayed())) {
      await $("#back-to-library").click()
      await $("#library-view").waitForDisplayed()
    }
  }

  async assertAllWorkKindsVisible(presentationTitle, documentTitle) {
    await browser.waitUntil(async () =>
      (await $(`[aria-label='Edit ${presentationTitle}']`).isDisplayed()) &&
      (await $(`[aria-label='Edit ${documentTitle}']`).isDisplayed()), {
      timeout: 10_000,
      timeoutMsg: "The All library view did not show both presentations and documents"
    })
    if ((await $$(".library-card")).length !== 5) {
      throw new Error("The All library view did not show all five fixture works")
    }
  }

  async assertCardPreview(title, text) {
    await browser.execute(workTitle => {
      const button = [...document.querySelectorAll(".library-card-open")]
        .find(element => element.getAttribute("aria-label") === `Edit ${workTitle}`)
      button?.scrollIntoView({ block: "center", inline: "nearest" })
    }, title)
    const findPreview = (workTitle, previewText) => {
      const button = [...document.querySelectorAll(".library-card-open")]
        .find(element => element.getAttribute("aria-label") === `Edit ${workTitle}`)
      const preview = button?.closest(".library-card")?.querySelector(".library-card-preview")
      return preview?.dataset.previewState === "ready" && preview.textContent.includes(previewText)
    }
    try {
      await browser.waitUntil(async () => browser.execute(findPreview, title, text), {
        timeout: 10_000,
        timeoutMsg: `The ${title} library preview did not render its Markdown`
      })
    } catch (error) {
      const diagnostic = await browser.execute(async (workTitle, previewText) => {
        const button = [...document.querySelectorAll(".library-card-open")]
          .find(element => element.getAttribute("aria-label") === `Edit ${workTitle}`)
        const card = button?.closest(".library-card")
        const preview = card?.querySelector(".library-card-preview")
        // Card DOM ids are `<kind>_<work id>`; the preview node itself no
        // longer carries the retired data-work-id attribute.
        const workId = card?.id?.replace(/^(?:presentation|document)_/, "")
        try {
          const workFolder = await window.__TAURI__.core.invoke("read_work_folder_preview", { id: workId })
          return {
            previewState: preview?.dataset.previewState ?? null,
            previewMissing: !preview,
            previewText: preview?.textContent?.slice(0, 240) || "",
            sourceHasExpectedText: workFolder.source.includes(previewText),
            sourceHasLocalImage: workFolder.source.includes("elef-asset:"),
            sourceFile: workFolder.source_file
          }
        } catch (readError) {
          return { previewState: preview?.dataset.previewState ?? null, previewMissing: !preview, readError: readError?.code || "unknown" }
        }
      }, title, text)
      throw new Error(`${error.message}; desktop preview diagnostic: ${JSON.stringify(diagnostic)}`)
    }
  }

  async assertDocumentCardTheme(title, theme) {
    const state = (workTitle, theme) => {
      const button = [...document.querySelectorAll(".library-card-open")]
        .find(element => element.getAttribute("aria-label") === `Edit ${workTitle}`)
      const preview = button?.closest(".library-card")?.querySelector(".library-card-preview")
      const surface = preview?.querySelector(".document-reader .document-surface")
      const frame = surface?.querySelector(".document-page-frame")
      const page = frame?.querySelector(".document-page")
      if (!preview || preview.dataset.previewState !== "ready" || surface?.dataset.documentPagesSettled !== "true" || !page) return null
      const rect = frame.getBoundingClientRect()
      return {
        hasTheme: Boolean(page.closest(`.document-reader.document-theme-${theme}`)),
        background: getComputedStyle(page).backgroundImage,
        backgroundColor: getComputedStyle(page).backgroundColor,
        ratio: rect.width / rect.height
      }
    }

    let result
    await browser.waitUntil(async () => {
      result = await browser.execute(state, title, theme)
      return result !== null
    }, {
      timeout: 10_000,
      timeoutMsg: `The ${title} library card did not paginate its ${theme} document preview`
    })
    const themeMatches = theme === "dark"
      ? result.background.includes("linear-gradient")
      : result.background === "none" && result.backgroundColor === "rgb(255, 253, 248)"
    if (!result.hasTheme || !themeMatches || Math.abs(result.ratio - 210 / 297) >= 0.005) {
      throw new Error(`The ${title} library card lost its ${theme} theme or A4 proportions: ${JSON.stringify(result)}`)
    }
  }

  async searchFor(query) {
    await $("#library-search").setValue(query)
  }

  async assertSearchResults(title) {
    await browser.waitUntil(async () => (await $$(".library-card")).length === 1, {
      timeout: 10_000,
      timeoutMsg: "The library search did not narrow to one work"
    })
    if (!(await $(`[aria-label='Edit ${title}']`).isDisplayed())) {
      throw new Error(`The library search did not show ${title}`)
    }
  }

  async assertNoSearchResults() {
    await $("#library-no-results").waitForDisplayed()
    await browser.waitUntil(async () => (await $("#library-no-results").getText()) === "No Works match this search.", {
      timeout: 10_000,
      timeoutMsg: "The library did not show its empty search result"
    })
    if ((await $$(".library-card")).length !== 0) throw new Error("The empty search still shows work cards")
  }

  async showPresentations() {
    await $("#show-presentations").click()
  }

  async assertPresentationsOnly(presentationTitle, documentTitle) {
    await browser.waitUntil(async () => (await $(`[aria-label='Edit ${presentationTitle}']`).isDisplayed()), {
      timeout: 10_000,
      timeoutMsg: "The presentation filter did not show its presentation"
    })
    if ((await $$(".library-card")).length !== 3) {
      throw new Error("The presentation filter did not show the three fixture presentations")
    }
    if (await $(`[aria-label='Edit ${documentTitle}']`).isExisting()) {
      throw new Error("The presentation filter still shows a document")
    }
  }

  async showDocuments() {
    await $("#show-documents").click()
  }

  async openLibraryDeepLink(filter) {
    await browser.execute(name => { window.location.hash = `#library/${name}` }, filter)
    await browser.refresh()
    await $("#library-view").waitForDisplayed({ timeout: 20_000 })
    await browser.waitUntil(async () => (await $$(".library-card")).length > 0, {
      timeout: 20_000,
      timeoutMsg: "The library did not render any cards after a deep-link reload"
    })
  }

  async setLibraryHash(filter) {
    await browser.execute(name => { window.location.hash = `#library/${name}` }, filter)
  }

  async assertDocumentsOnly(documentTitle) {
    await browser.waitUntil(async () => (await $(`[aria-label='Edit ${documentTitle}']`).isDisplayed()), {
      timeout: 10_000,
      timeoutMsg: "The document filter did not show its document"
    })
    if ((await $$(".library-card")).length !== 2) {
      throw new Error("The document filter did not show the two fixture documents")
    }
    if (await $(`[aria-label='Edit E2E seed']`).isExisting()) {
      throw new Error("The document filter still shows a presentation")
    }
  }

  async showDocumentGraph() {
    await $("#document-graph-heading").waitForDisplayed()
  }

  async assertGraphDocumentsVisible(count, linkedTitle) {
    await browser.waitUntil(async () => (await $$(".document-graph-node")).length === count, {
      timeout: 10_000,
      timeoutMsg: "The shared graph component did not render its document nodes"
    })
    await $(`[aria-label='Open ${linkedTitle}']`).waitForDisplayed()
  }

  async openGraphDocument(title) {
    const opened = await browser.execute(expectedTitle => {
      const node = [...document.querySelectorAll(".document-graph-node")]
        .find(candidate => candidate.getAttribute("aria-label") === `Open ${expectedTitle}`)
      if (!node) throw new Error(`The graph node for ${expectedTitle} is unavailable`)
      // The embedded WebDriver's native click path does not support SVGAnchorElement.
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      return !node.dispatchEvent(event)
    }, title)
    if (!opened) throw new Error(`The graph did not handle the ${title} activation`)
  }

  async assertDocumentOpened(title) {
    await browser.waitUntil(async () => (await $("#work-title").getText()) === title, {
      timeout: 10_000,
      timeoutMsg: `The graph did not open ${title}`
    })
  }

  async openElefArchive(
    archivePath = process.env.ELEF_E2E_IMPORT_ARCHIVE,
    workName = "E2E archive seed",
    expectedSource = "Portable archive fixture."
  ) {
    await this.openLibrary()
    await browser.execute(() => window.focus())
    let singleInstanceOwner = "platform transport not inspected"
    if (process.platform === "linux") {
      const busNames = execFileSync("busctl", ["--user", "list", "--no-legend"], { encoding: "utf8" })
      singleInstanceOwner = busNames
        .split("\n")
        .find(line => line.startsWith("org.com_elef_desktop_e2e.SingleInstance ")) || "not registered"
      if (singleInstanceOwner === "not registered") {
        throw new Error("The running desktop app did not register its Linux single-instance D-Bus name")
      }
    }
    const launched = spawn(process.env.ELEF_E2E_APP_BINARY, [archivePath], {
      stdio: ["ignore", "pipe", "pipe"]
    })
    let launchError = null
    let launchExit = null
    let launchOutput = ""
    const recordLaunchOutput = chunk => {
      launchOutput = (launchOutput + chunk.toString()).slice(-4000)
    }
    launched.stdout.on("data", recordLaunchOutput)
    launched.stderr.on("data", recordLaunchOutput)
    launched.once("error", error => { launchError = error })
    launched.once("exit", (code, signal) => { launchExit = { code, signal } })
    try {
      const card = $(`[aria-label="Edit ${workName}"]`)
      try {
        await browser.waitUntil(async () => {
          if (launchError) throw new Error(`Opening the .elef file failed: ${launchError.message}`)
          return card.isDisplayed()
        }, {
          timeout: 20_000,
          timeoutMsg: `The running desktop app did not import ${workName} from the opened .elef file`
        })
      } catch (error) {
        const state = await browser.execute(() => ({
          status: document.querySelector("#status-text")?.textContent || "",
          notice: document.querySelector("#notice")?.textContent || "",
          cards: [...document.querySelectorAll(".library-card")].map(card => card.getAttribute("aria-label"))
        })).catch(() => ({ unavailable: true }))
        const pending = await browser.execute(async () => window.__TAURI__?.core?.invoke("pending_open_elef_count"))
          .catch(() => "unavailable")
        throw new Error(`${error.message}; launch exit: ${JSON.stringify(launchExit)}; pending .elef files: ${pending}; library state: ${JSON.stringify(state)}; single-instance owner before launch: ${singleInstanceOwner}; second-process output: ${JSON.stringify(launchOutput)}`)
      }
      await card.click()
      await browser.waitUntil(async () => (await $("#work-title").getText()) === workName, {
        timeout: 10_000,
        timeoutMsg: `The imported .elef work ${workName} did not open`
      })
      const source = await browser.execute(() => document.querySelector("#desktop-editor-field")?.editorController?.sourceValue || "")
      if (!source.includes(expectedSource)) throw new Error(`The imported .elef source did not include ${expectedSource}`)
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

describe("desktop binary workflows and native boundaries", () => {
  it("creates a presentation directly from the native menu accelerator", async () => {
    await $("#library-view").waitForDisplayed()
    await browser.execute(() => window.focus())
    if (process.platform === "darwin") {
      execFileSync("osascript", ["-e", 'tell application "System Events" to keystroke "n" using {command down}'], { timeout: 5_000 })
    } else if (process.platform === "linux") {
      execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+n"], { timeout: 5_000 })
    } else {
      throw new Error(`Native menu smoke is unsupported on ${process.platform}`)
    }
    // Web parity: File → New Presentation skips the name dialog and opens
    // the editor with the shared unique default title, like the header menu.
    await $("#work-view").waitForDisplayed()
    const title = await $("#desktop-editor-title").getValue()
    assert.match(title, /^Untitled presentation( \d+)?$/)
    const library = new DesktopLibraryUi()
    await library.openLibrary()
    await library.deleteWork(title)
    await library.assertWorkAbsent(title)
  })

  it("opens a library work with the caret at the start of its active editor", async () => {
    const ui = new DesktopEditorUi()
    await ui.openWork()
    await ui.captureCaretAutofocusShot("library-open")
    await ui.assertCaretAtStartOnOpen()
  })

  it("creates a work from the New menu with the caret at the start of its active editor", async () => {
    const library = new DesktopLibraryUi()
    await library.openLibrary()
    await $(".new-work-trigger").click()
    await $("[data-new-work-kind=\"presentation\"]").click()
    // Direct-create parity with the web menu: the click skips the name
    // dialog and lands in the editor, which must already hold caret-at-0
    // focus before any rename moves focus to the title field.
    await $("#work-view").waitForDisplayed()
    let title = null
    try {
      title = await $("#desktop-editor-title").getValue()
      const ui = new DesktopEditorUi()
      await ui.captureCaretAutofocusShot("direct-create-open")
      await ui.assertCaretAtStartOnOpen()
    } finally {
      if (title) {
        await library.openLibrary()
        await library.deleteWork(title)
        await library.assertWorkAbsent(title)
      }
    }
  })

  it("opens and cancels the native library folder picker", async () => {
    await $("#change-library").click()
    if (process.platform === "darwin") {
      answerMacNativeDialog("Cancel")
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

  it("neutralizes hostile Markdown before it reaches the Tauri preview DOM", async () => {
    await hostileWorkNeutralizedWorkflow(new DesktopEditorUi())
  })

  it("edits, saves, and previews a work in the desktop binary", async () => {
    await editAndPreviewWorkflow(new DesktopEditorUi())
    const form = await $("#desktop-editor-form")
    if (await form.getAttribute("data-editor-mode") !== "visual") {
      throw new Error("The editor did not switch into visual mode")
    }
  })

  it("opens the next work after leaving a focused visual editor", async () => {
    const ui = new DesktopEditorUi()
    await ui.openWork("E2E seed")
    const focused = await browser.execute(() => {
      const block = document.querySelector("#desktop-preview [contenteditable='true']")
      block?.focus()
      return Boolean(block && document.activeElement === block)
    })
    if (!focused) throw new Error("The visual editor block did not receive focus")

    await ui.showSourceMode()
    await ui.openWork("E2E document")
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector("#desktop-editor-form")?.dataset.editorMode === "visual" &&
      !document.querySelector("#visual-mode")?.disabled
    ), {
      timeout: 10_000,
      timeoutMsg: "The next work preview stayed disabled after switching from a focused visual block"
    })
  })

  it("runs the shared presentation navigation flow in the desktop binary", async () => {
    await presentationModeWorkflow(new DesktopEditorUi())
  })

  it("exports PPTX through the desktop Export menu option into the harness path", async () => {
    await exportWorkflow(new DesktopEditorUi())
  })

  it("offers one Export menu whose options vary by work kind", async () => {
    const ui = new DesktopEditorUi()
    // The print option must reach the native print_work command (script
    // window.print() is a silent no-op in the desktop webviews on macOS and
    // Linux). The WebDriver harness cannot dismiss the platform print
    // dialog, so the command resolves without opening one there, and the
    // app records which delivery seam it used for the driver to assert.
    async function expectPrintOptionReachesPipeline() {
      await browser.execute(() => { delete window.__elefPrintResult })
      await ui.openExportMenu()
      await $("#print-work").click()
      await browser.waitUntil(async () => browser.execute(() => window.__elefPrintResult?.native === true), {
        timeout: 10_000,
        timeoutMsg: "The PDF option did not reach the native print command"
      })
      await ui.assertExportMenuClosed("the print option")
      // The native dialog fires no afterprint event: the printing-work
      // marker must clear when the command resolves instead of leaking.
      const markerLeaked = await browser.execute(() => document.body.classList.contains("printing-work"))
      if (markerLeaked) throw new Error("The printing-work marker leaked after the native print command resolved")
    }

    await ui.openWork("E2E seed")
    await $("#export-menu-button").waitForDisplayed()
    await ui.openExportMenu()
    await $("#print-work").waitForDisplayed()
    await $("#export-pptx").waitForDisplayed()
    // The menu dismisses without choosing: Escape closes it and it reopens.
    await browser.keys(Key.Escape)
    await ui.assertExportMenuClosed("Escape")
    await ui.openExportMenu()
    // An outside pointerdown closes it too; the save note is inert.
    await $(".desktop-save-note").click()
    await ui.assertExportMenuClosed("an outside click")
    await expectPrintOptionReachesPipeline()

    await ui.openWork("E2E document")
    await $("#export-menu-button").waitForDisplayed()
    await ui.openExportMenu()
    await $("#print-work").waitForDisplayed()
    await browser.waitUntil(async () => !(await $("#export-pptx").isDisplayed()), {
      timeout: 10_000,
      timeoutMsg: "The PPTX option stayed visible for a document work"
    })
    await expectPrintOptionReachesPipeline()
  })

  it("keeps slide position stacks and lanes aligned in the desktop preview", async () => {
    await slidePositionGrammarWorkflow(new DesktopEditorUi())
  })

  it("updates Vim relative line numbers from CodeMirror cursor positions", async () => {
    await vimRelativeLineNumbersWorkflow(new DesktopEditorUi())
  })

  it("keeps document pages at A4 proportions when the desktop window is resized", async () => {
    await documentPageAspectRatioWorkflow(new DesktopEditorUi())
  })

  it("accepts trusted keyboard input in CodeMirror and persists it", async () => {
    const ui = new DesktopEditorUi()
    await ui.openWork()
    await ui.showSourceMode()
    const original = await ui.readSource()
    const inserted = "Native keyboard input reaches CodeMirror."
    const needsLineBreak = !original.endsWith("\n")
    const expected = `${original}${needsLineBreak ? "\n" : ""}${inserted}`
    try {
      await browser.execute(() => window.focus())
      focusDesktopWindow()
      await browser.execute(() => {
        const field = document.querySelector("#desktop-editor-field")
        const editor = field?.editorController
        if (!editor) throw new Error("The desktop CodeMirror controller is unavailable")
        const events = []
        const handler = event => events.push({ key: event.key, trusted: event.isTrusted })
        editor.view.contentDOM.addEventListener("keydown", handler)
        window.__elefTrustedEditorKeys = { target: editor.view.contentDOM, handler, events }
        editor.setSelectionRange(editor.sourceValue.length)
        editor.view.focus()
        if (!editor.view.hasFocus || document.activeElement !== editor.view.contentDOM) {
          throw new Error(`CodeMirror did not receive focus: ${JSON.stringify({
            editorHasFocus: editor.view.hasFocus,
            activeElement: document.activeElement?.outerHTML?.slice(0, 240) || null,
            dialogs: [...document.querySelectorAll("dialog[open]")].map(dialog => dialog.id)
          })}`)
        }
      })
      const vimEnabled = await browser.execute(() =>
        document.querySelector("#desktop-editor-field")?.editorController?.vimEnabled === true
      )
      if (vimEnabled) {
        typeNativeText("i", { activate: false })
        await browser.waitUntil(async () => browser.execute(() =>
          document.querySelector("#desktop-editor-field")?.editorController?.vimMode?.startsWith("insert") === true
        ), {
          timeout: 5_000,
          timeoutMsg: "The native editor did not enter Vim insert mode"
        })
      }
      if (needsLineBreak) sendNativeKey("Enter", { activate: false })
      typeNativeText(inserted, { activate: false })

      const focus = await browser.execute(() => {
        const editor = document.querySelector("#desktop-editor-field")?.editorController
        return {
          hasFocus: document.hasFocus(),
          editorHasFocus: editor?.view.hasFocus ?? false,
          activeElement: document.activeElement && {
            tag: document.activeElement.tagName,
            id: document.activeElement.id,
            className: String(document.activeElement.className || "")
          }
        }
      })
      // Snapshot without detaching: lagged tail keystrokes may still be in
      // flight when typing returns, so the listener stays until the buffer
      // proves they landed.
      const earlyKeys = await browser.execute(() => {
        const tracker = window.__elefTrustedEditorKeys
        return tracker?.events.slice() || []
      })
      if (!earlyKeys.some(event => event.trusted && event.key.toLowerCase() === "n")) {
        throw new Error(`Native input did not reach CodeMirror: ${JSON.stringify({ focus, trustedKeys: earlyKeys })}`)
      }
      const keydownDiagnostics = async () => {
        const lateKeys = await browser.execute(() => window.__elefTrustedEditorKeys?.events.slice() || []).catch(() => [])
        const sequence = lateKeys.map(event => (event.trusted ? event.key : `(${event.key}?)`)).join(" ")
        return `keydown sequence (${lateKeys.length}): ${sequence}`
      }
      // Native synthesis occasionally delivers a keydown whose text never
      // inserts (observed: single dropped chars with full keydown arrival).
      // Retype exactly the missing span once, natively, before failing: the
      // pass criteria below stay identical, and any retry is logged.
      let nativeCharsSent = inserted.length + (vimEnabled ? 1 : 0) + (needsLineBreak ? 1 : 0)
      try {
        await ui.waitForSource(expected)
      } catch (firstError) {
        const buffer = await ui.readSource()
        let prefix = 0
        while (prefix < buffer.length && prefix < expected.length && buffer[prefix] === expected[prefix]) prefix++
        let suffix = 0
        while (suffix < buffer.length - prefix && suffix < expected.length - prefix &&
          buffer[buffer.length - 1 - suffix] === expected[expected.length - 1 - suffix]) suffix++
        const missing = expected.slice(prefix, expected.length - suffix)
        const retryable = buffer.startsWith(original) && buffer.length - prefix - suffix === 0 && missing.length > 0
        if (!retryable) throw new Error(`${firstError.message}; ${await keydownDiagnostics()}`)
        console.error(`E2E-RETRY: native typing dropped ${missing.length} char(s) at offset ${prefix}; retyping span.`)
        await browser.execute(offset => {
          document.querySelector("#desktop-editor-field")?.editorController?.setSelectionRange(offset)
        }, prefix)
        typeNativeText(missing, { activate: false })
        nativeCharsSent += missing.length
        await ui.waitForSource(expected).catch(async secondError => {
          throw new Error(`${secondError.message}; after retyping ${missing.length} char(s) at offset ${prefix}; ${await keydownDiagnostics()}`)
        })
      }
      const trustedKeys = await browser.execute(() => {
        const tracker = window.__elefTrustedEditorKeys
        tracker?.target.removeEventListener("keydown", tracker.handler)
        delete window.__elefTrustedEditorKeys
        return tracker?.events || []
      })
      // Every synthesized character must surface as a trusted keydown. Extras
      // (modifier or repeat events) are harmless; anything below the minimum
      // means keystrokes were swallowed before CodeMirror.
      const trustedCount = trustedKeys.filter(event => event.trusted).length
      const expectedMinKeys = nativeCharsSent
      if (trustedCount < expectedMinKeys) {
        const sequence = trustedKeys.map(event => (event.trusted ? event.key : `(${event.key}?)`)).join(" ")
        throw new Error(`Native input lost keystrokes before CodeMirror: ${JSON.stringify({ focus, trustedCount, expectedMinKeys, sequence })}`)
      }
      await ui.waitForSaved(expected)
    } finally {
      await browser.execute(source => {
        const tracker = window.__elefTrustedEditorKeys
        tracker?.target.removeEventListener("keydown", tracker.handler)
        delete window.__elefTrustedEditorKeys
        const editor = document.querySelector("#desktop-editor-field")?.editorController
        if (editor && editor.sourceValue !== source) editor.replaceRange(source, 0, editor.sourceValue.length)
      }, original)
      await ui.waitForSaved(original)
    }
  })

  it("runs the shared library and document graph flow", async () => {
    await libraryAndGraphWorkflow(new DesktopLibraryUi())
  })

  it("runs the shared library create and delete flow", async () => {
    await libraryCreateDeleteWorkflow(new DesktopLibraryUi())
  })

  it("runs the shared library deep links flow", async function () {
    // Three full-boot deep-link reloads cost ~20s each on macOS CI runners
    // (WebKit boot behind the postMessage IPC fallback); the per-step waits
    // still bound every stage, this only extends the total budget.
    this.timeout(180_000)
    await libraryDeepLinksWorkflow(new DesktopLibraryUi())
  })

  it("persists appearance through the shared editing flow", async () => {
    await appearanceWorkflow(new DesktopEditorUi())
  })

  it("renders shared Art list semantics in the Tauri binary", async () => {
    await artRenderingWorkflow(new DesktopEditorUi())
  })

  it("renders, presents, saves, and reopens the rich release fixture", async () => {
    const root = process.env.ELEF_E2E_LIBRARY_ROOT
    if (!(await $("#library-view").isDisplayed())) {
      await $("#back-to-library").click()
      await $("#library-view").waitForDisplayed()
    }
    await setupRichRenderingWork(root)
    await $("#refresh-library").click()
    let workflowError = null
    try {
      await richRenderingMediaWorkflow(new DesktopEditorUi())
    } catch (error) {
      workflowError = error
    }
    // A throwing cleanup would swallow the workflow failure that explains a
    // cascade, so the state dump and teardown run here and never mask it.
    await logDesktopAppState("rich-fixture")
    try {
      try {
        if (!(await $("#library-view").isDisplayed())) {
          await $("#back-to-library").click()
          await $("#library-view").waitForDisplayed()
        }
      } finally {
        await teardownRichRenderingWork(root)
      }
      if (await $("#library-view").isDisplayed()) await $("#refresh-library").click()
    } catch (cleanupError) {
      if (workflowError) {
        console.log(`ELEF-APP-STATE rich-fixture cleanup failed after the workflow error: ${cleanupError.message}`)
      } else {
        throw cleanupError
      }
    }
    if (workflowError) throw workflowError
  })

  it("runs the shared external-edit conflict flow in the desktop binary", async () => {
    const ui = new DesktopEditorUi()
    await externalEditConflictWorkflow(ui)
    if (await ui.readSource() !== CONFLICT_EXTERNAL_SOURCE) {
      throw new Error("Resolving the conflict did not load the external source")
    }
  })

  it("keeps the local version through the shared external-edit conflict flow", async () => {
    await externalEditConflictWorkflow(new DesktopEditorUi(), "local")
  })

  it("saves a merge through the shared external-edit conflict flow", async () => {
    await externalEditConflictWorkflow(new DesktopEditorUi(), "merge")
  })

  it("runs the shared snippet insertion flow in the desktop binary", async () => {
    await snippetInsertWorkflow(new DesktopEditorUi())
  })

  it("runs the shared document-link completion flow in the desktop binary", async () => {
    await documentLinkCompletionWorkflow(new DesktopEditorUi())
  })

  it("runs the shared authoring settings create, edit, and delete flow in the desktop binary", async () => {
    await authoringSettingsWorkflow(new DesktopEditorUi())
  })

  it("shows the updater affordance only where the updater boundary allows it", async () => {
    await openDesktopAuthoringSettings()
    // The updater boundary is macOS-only: macOS shows the settings Updates
    // section, while Linux (package-managed) renders no updater affordance.
    if (process.platform === "linux") {
      assert.equal(await $("section[aria-label='Updates']").isExisting(), false)
    } else {
      const updates = $("section[aria-label='Updates']")
      await updates.waitForDisplayed({ timeout: 10_000 })
      // Presence is capability-driven; the status line itself may still be
      // resolving the updater endpoint in the background.
      await $("section[aria-label='Updates'] button").waitForDisplayed()
    }
    await $("#close-authoring-settings").click()
    await $("#authoring-settings-dialog").waitForDisplayed({ reverse: true })
  })

  it("runs the shared math input flow in the desktop binary", async () => {
    await mathInputWorkflow(new DesktopEditorUi())
  })

  it("keeps the empty display-math body caret in both desktop editor modes", async () => {
    await displayMathEnterWorkflow(new DesktopEditorUi())
  })

  it("saves a manifestless work with its new identity, original line endings, and isolated undo", async () => {
    const root = process.env.ELEF_E2E_LIBRARY_ROOT
    const title = "E2E manifestless lifecycle"
    const folder = path.join(root, title)
    const sourcePath = path.join(folder, "presentation.md")
    const original = "# Work\r\n\r\nBody bytes stay unchanged.\r\n"
    const edited = original.replace("Work", "Edited")
    const ui = new DesktopEditorUi()
    await $("#back-to-library").click()
    await $("#library-view").waitForDisplayed()
    await mkdir(folder)
    try {
      await writeFile(sourcePath, original)
      await $("#refresh-library").click()
      await ui.openWork(title)
      await browser.waitUntil(async () => await ui.readSource() === original, {
        timeoutMsg: "Opening the manifestless work changed its source bytes"
      })
      const manifest = JSON.parse(await readFile(path.join(folder, "elef.json"), "utf8"))
      if (await $("#work-id").getText() !== manifest.id) throw new Error("The new manifest identity was not activated")
      await ui.showSourceMode()
      await browser.execute(() => {
        const editor = document.querySelector("#desktop-editor-field").editorController
        editor.replaceRange("Edited", 2, 6)
      })
      await browser.waitUntil(async () => await readFile(sourcePath, "utf8") === edited, {
        timeoutMsg: "The first save lost the UUID handshake or source line endings"
      })
      await ui.openWork("E2E seed")
      const seed = await ui.readSource()
      await ui.showSourceMode()
      await ui.undo()
      if (await ui.readSource() !== seed) throw new Error("Undo copied the previous work into the seed work")
      await ui.openWork(title)
      if (await ui.readSource() !== edited) throw new Error("Reopening did not retain the first saved source")
      await ui.undo()
      if (await ui.readSource() !== edited) throw new Error("Reopening inherited another work's undo history")
      await $("#back-to-library").click()
      await $("#library-view").waitForDisplayed()
    } finally {
      await rm(folder, { recursive: true, force: true })
      await $("#refresh-library").click()
    }
  })

  it("loads custom snippets and math shortcuts from the selected library .elef settings", async () => {
    const ui = new DesktopEditorUi()
    await ui.openWork()
    const originalSource = await ui.readSource()

    const snippetPrefix = `${originalSource.trimEnd()}\n`
    await ui.replaceSource(`${snippetPrefix}/note`)
    await ui.waitForAuthoringOption("snippet", "Personal note")
    await ui.selectAuthoringOption("snippet", "Personal note")
    const withSnippet = `${snippetPrefix}**note**`
    await ui.waitForSource(withSnippet)

    const mathPrefix = `${withSnippet}\n\n$$\n`
    await ui.replaceSource(`${mathPrefix}@lambda`)
    await ui.waitForAuthoringOption("math", "Lambda")
    await ui.selectAuthoringOption("math", "Lambda")
    const withMath = `${mathPrefix}\\lambda`
    await ui.waitForSource(withMath)
    await ui.waitForSaved(withMath)
    await ui.replaceSource(originalSource)
    await ui.waitForSaved(originalSource)

    const library = new DesktopLibraryUi()
    await library.openLibrary()
    await $("#refresh-library").click()
    await browser.waitUntil(async () => (await $("#status-text").getText()).includes("Works"), {
      timeout: 10_000,
      timeoutMsg: "Refreshing the library did not finish loading its authoring settings"
    })
    await ui.openWork()
    await ui.showVisualMode()
    await ui.waitForImage(PIXEL_PNG_DIGEST)

    const refreshedSnippetPrefix = `${originalSource.trimEnd()}\n`
    await ui.replaceSource(`${refreshedSnippetPrefix}/note`)
    await ui.waitForAuthoringOption("snippet", "Personal note")
    await ui.selectAuthoringOption("snippet", "Personal note")
    const withRefreshedSnippet = `${refreshedSnippetPrefix}**note**`
    await ui.waitForSource(withRefreshedSnippet)

    await ui.replaceSource(`${withRefreshedSnippet}\n\n$$\n@lambda`)
    await ui.waitForAuthoringOption("math", "Lambda")
    await ui.selectAuthoringOption("math", "Lambda")
    const refreshedSource = `${withRefreshedSnippet}\n\n$$\n\\lambda`
    await ui.waitForSource(refreshedSource)
    await ui.waitForSaved(refreshedSource)

    await ui.replaceSource(originalSource)
    await ui.waitForSaved(originalSource)
  })

  it("manages personal snippets through the desktop authoring settings", async () => {
    await openDesktopAuthoringSettings()
    await $('[data-authoring-tab="snippets"]').click()
    await browser.waitUntil(async () => (await $('[data-authoring-tab="snippets"]').getAttribute("aria-selected")) === "true", {
      timeout: 5_000,
      timeoutMsg: "The snippets authoring settings tab did not open"
    })
    await $("#new-authoring-entry").click()

    const trigger = `managed${Date.now()}`
    await $("#authoring-name").setValue("Managed E2E snippet")
    await $("#authoring-trigger").setValue(trigger)
    await $("#authoring-description").setValue("Created through desktop settings")
    await $("#authoring-category").selectByVisibleText("Markdown")
    await $("#authoring-body").setValue("**${1:managed}**")
    await $("#save-authoring-entry").click()
    try {
      await browser.waitUntil(async () => (await $("#authoring-settings-status").getText()).includes("saved (snippet)"), {
        timeout: 10_000,
        timeoutMsg: "Saving the personal snippet did not finish"
      })
    } catch (error) {
      const diagnostic = await browser.execute(async () => {
        const form = document.querySelector("#authoring-entry-form")
        const fields = ["authoring-name", "authoring-trigger", "authoring-description", "authoring-category", "authoring-body"]
        return {
          status: document.querySelector("#authoring-settings-status")?.textContent || "",
          formVisible: form ? !form.hidden : null,
          formValid: form?.checkValidity() ?? null,
          fields: Object.fromEntries(fields.map(id => {
            const field = document.getElementById(id)
            return [id, { value: field?.value, disabled: field?.disabled, valid: field?.validity?.valid, validationMessage: field?.validationMessage }]
          })),
          registries: await window.__TAURI__.core.invoke("read_authoring_registries")
        }
      })
      throw new Error(`${error.message}; authoring save diagnostic: ${JSON.stringify(diagnostic)}`)
    }

    const persisted = await browser.execute(async () => await window.__TAURI__.core.invoke("read_authoring_registries"))
    const savedEntry = persisted.snippets.find(entry => entry.trigger === trigger)
    if (!savedEntry || savedEntry.body !== "**${1:managed}**") {
      throw new Error("The personal snippet was not written to the library registry file")
    }
    let createdCard
    for (const card of await $$(".authoring-entry-card")) {
      if ((await card.getText()).includes(trigger)) createdCard = card
    }
    if (!createdCard) throw new Error("The saved personal snippet was not listed for editing")
    const cardActions = await createdCard.$$(".authoring-entry-actions button")
    await cardActions[0].click()
    await $("#authoring-name").setValue("Managed E2E snippet edited")
    await $("#authoring-description").setValue("Updated through desktop settings")
    await $("#save-authoring-entry").click()
    await browser.waitUntil(async () => (await $("#authoring-settings-status").getText()).includes("Changes saved (snippet)"), {
      timeout: 10_000,
      timeoutMsg: "Editing the personal snippet did not finish"
    })
    const updatedRegistries = await browser.execute(async () => await window.__TAURI__.core.invoke("read_authoring_registries"))
    const updatedEntry = updatedRegistries.snippets.find(entry => entry.trigger === trigger)
    if (updatedEntry?.name !== "Managed E2E snippet edited" || updatedEntry.description !== "Updated through desktop settings") {
      throw new Error("Editing the personal snippet did not update the library registry file")
    }

    await $("#close-authoring-settings").click()
    const ui = new DesktopEditorUi()
    await ui.openWork()
    const originalSource = await ui.readSource()
    const prefix = `${originalSource.trimEnd()}\n`
    await ui.replaceSource(`${prefix}/${trigger}`)
    await ui.waitForAuthoringOption("snippet", "Managed E2E snippet edited")
    await ui.selectAuthoringOption("snippet", "Managed E2E snippet edited")
    const expandedSource = `${prefix}**managed**`
    await ui.waitForSource(expandedSource)
    await ui.waitForSaved(expandedSource)
    await ui.replaceSource(originalSource)
    await ui.waitForSaved(originalSource)

    const library = new DesktopLibraryUi()
    await library.openLibrary()
    await openDesktopAuthoringSettings()
    let targetCard
    for (const card of await $$(".authoring-entry-card")) {
      if ((await card.getText()).includes(trigger)) targetCard = card
    }
    if (!targetCard) throw new Error("The saved personal snippet was not listed for management")
    await targetCard.$(".authoring-delete").click()
    await confirmAuthoringDeletion("Managed E2E snippet edited")
    await browser.waitUntil(async () => (await $("#authoring-settings-status").getText()).includes("saved (snippet)"), {
      timeout: 10_000,
      timeoutMsg: "Deleting the personal snippet did not finish"
    })
    const afterDelete = await browser.execute(async () => await window.__TAURI__.core.invoke("read_authoring_registries"))
    if (afterDelete.snippets.some(entry => entry.trigger === trigger)) {
      throw new Error("Deleting the personal snippet left it in the library registry file")
    }
  })

  it("creates and deletes a personal math shortcut through desktop settings", async () => {
    await openDesktopAuthoringSettings()
    await $('[data-authoring-tab="math_shortcuts"]').click()
    await $("#new-authoring-entry").click()
    const alias = `elefe2e${Date.now()}`
    await $("#authoring-math-name").setValue("E2E math shortcut")
    // The embedded WebKit driver does not apply native select keyboard input
    // consistently; dispatch the same change event and verify persisted data.
    const selectedPrefix = await browser.execute(() => {
      const prefix = document.querySelector("#authoring-prefix")
      if (!prefix) return null
      prefix.value = "@"
      prefix.dispatchEvent(new Event("input", { bubbles: true }))
      prefix.dispatchEvent(new Event("change", { bubbles: true }))
      return prefix.value
    })
    if (selectedPrefix !== "@") {
      throw new Error("Selecting the @ math shortcut prefix did not update the form")
    }
    await $("#authoring-aliases").setValue(alias)
    await $("#authoring-expansion").setValue("\\mathbb{${1}}")
    await $("#save-authoring-entry").click()
    await browser.waitUntil(async () => (await $("#authoring-settings-status").getText()).includes("saved (math shortcut)"), {
      timeout: 10_000,
      timeoutMsg: "Saving the personal math shortcut did not finish"
    })

    const persisted = await browser.execute(async () => await window.__TAURI__.core.invoke("read_authoring_registries"))
    const entry = persisted.math_shortcuts.find(shortcut => shortcut.aliases.includes(alias))
    if (entry?.prefix !== "@" || entry.expansion !== "\\mathbb{${1}}" || entry.description !== "") {
      throw new Error(`The personal math shortcut was not persisted as entered: ${JSON.stringify(entry)}`)
    }

    let targetCard
    for (const candidate of await $$(".authoring-entry-card")) {
      if ((await candidate.getText()).includes(alias)) targetCard = candidate
    }
    if (!targetCard) throw new Error("The saved math shortcut was not listed for management")
    await targetCard.$(".authoring-delete").click()
    await confirmAuthoringDeletion("E2E math shortcut")
    await browser.waitUntil(async () => (await $("#authoring-settings-status").getText()).includes("saved (math shortcut)"), {
      timeout: 10_000,
      timeoutMsg: "Deleting the personal math shortcut did not finish"
    })
    const afterDelete = await browser.execute(async () => await window.__TAURI__.core.invoke("read_authoring_registries"))
    if (afterDelete.math_shortcuts.some(shortcut => shortcut.aliases.includes(alias))) {
      throw new Error("Deleting the personal math shortcut left it in the library registry file")
    }
  })

  it("rejects unsupported and oversized media without changing the source", async () => {
    const ui = new DesktopEditorUi()
    await ui.openWork()
    const imagesPath = path.join(process.env.ELEF_E2E_LIBRARY_ROOT, "E2E seed", "images")
    const filesBefore = (await readdir(imagesPath)).sort()
    const unsupportedStatus = await ui.rejectMediaFile({
      filename: "unsupported.svg",
      mimeType: "image/svg+xml",
      contents: "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"
    })
    if (!unsupportedStatus.includes("requested name or source is invalid")) {
      throw new Error(`The desktop did not surface the typed unsupported-media error: ${unsupportedStatus}`)
    }

    const oversizedStatus = await ui.rejectMediaFile({
      filename: "oversized.png",
      mimeType: "image/png",
      size: 50 * 1024 * 1024 + 1
    })
    if (oversizedStatus !== "Media files must be between 1 byte and 50 MB.") {
      throw new Error(`The desktop did not surface the media size limit: ${oversizedStatus}`)
    }
    const filesAfter = (await readdir(imagesPath)).sort()
    if (JSON.stringify(filesAfter) !== JSON.stringify(filesBefore)) {
      throw new Error(`Rejected media changed the work's images directory: ${JSON.stringify({ filesBefore, filesAfter })}`)
    }
  })

  it("imports a portable .elef opened by the running application", async () => {
    await new DesktopLibraryUi().openElefArchive()
  })

  it("resolves portable graph keys and aliases after importing a .elef archive", async () => {
    const ui = new DesktopLibraryUi()
    await ui.openLibrary()
    for (const [name, id, link] of [
      ["E2E portable key source", process.env.ELEF_E2E_PORTABLE_KEY_SOURCE_ID, "[[document:e2e-portable-graph-key]]"],
      ["E2E portable alias source", process.env.ELEF_E2E_PORTABLE_ALIAS_SOURCE_ID, "[[E2E portable graph alias]]"]
    ]) {
      const folder = path.join(process.env.ELEF_E2E_LIBRARY_ROOT, name)
      await mkdir(folder, { recursive: true })
      await writeFile(path.join(folder, "document.md"), `# ${name}\n\n${link}\n`)
      await writeFile(path.join(folder, "elef.json"), JSON.stringify({ id, schema_version: 1 }))
    }
    await $("#refresh-library").click()
    await ui.openElefArchive(
      process.env.ELEF_E2E_PORTABLE_GRAPH_ARCHIVE,
      "E2E portable graph archive",
      "E2E portable graph target"
    )
    await $("#back-to-library").click()
    await $("#library-view").waitForDisplayed()
    await ui.showDocuments()
    await ui.showDocumentGraph()

    const target = process.env.ELEF_E2E_PORTABLE_GRAPH_TARGET_ID
    const edges = await browser.execute(expectedTarget => [...document.querySelectorAll(".document-graph-edge")]
      .filter(edge => edge.dataset.targetId === expectedTarget)
      .map(edge => `${edge.dataset.sourceId}->${edge.dataset.targetId}`).sort(), target)
    const expectedEdges = [
      `${process.env.ELEF_E2E_PORTABLE_KEY_SOURCE_ID}->${target}`,
      `${process.env.ELEF_E2E_PORTABLE_ALIAS_SOURCE_ID}->${target}`
    ].sort()
    if (JSON.stringify(edges) !== JSON.stringify(expectedEdges)) {
      throw new Error(`Imported portable graph metadata did not resolve both links: ${JSON.stringify({ edges, expectedEdges })}`)
    }
  })

  it("exports a portable .elef archive from the desktop command", async () => {
    const exported = await browser.execute(async id =>
      window.__TAURI__?.core?.invoke("export_elef", { id }),
    process.env.ELEF_E2E_SEED_WORK_ID)
    if (exported !== true) throw new Error("The desktop export command did not write the .elef archive")
    // The conformance spec later exports other works through the same
    // harness file, so snapshot the seed bytes before they are replaced.
    const exportPath = process.env.ELEF_E2E_EXPORT_PATH
    if (!exportPath) throw new Error("ELEF_E2E_EXPORT_PATH is not set for the seed export snapshot")
    await copyFile(exportPath, `${exportPath}.seed-bytes`)
  })

  it("opens and cancels the native .elef export dialog", async () => {
    await new DesktopEditorUi().openWork()
    await browser.execute(() => window.focus())
    const started = await browser.execute(id => {
      if (!window.__TAURI__?.core?.invoke) return false
      window.__elefExportDialog = window.__TAURI__.core.invoke("export_elef", {
        id,
        useNativeDialog: true
      })
      return true
    }, process.env.ELEF_E2E_SEED_WORK_ID)
    if (!started) throw new Error("The native export command could not be started")

    if (process.platform === "darwin") {
      answerMacNativeDialog("Cancel")
    } else if (process.platform === "linux") {
      let dialogId
      await browser.waitUntil(async () => {
        try {
          dialogId = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "Export Elef Work"], { encoding: "utf8" })
            .trim().split(/\s+/).at(-1)
          return Boolean(dialogId)
        } catch (_error) {
          return false
        }
      }, {
        timeout: 5_000,
        timeoutMsg: "The native .elef export dialog did not open"
      })
      execFileSync("xdotool", ["windowactivate", "--sync", dialogId], { timeout: 5_000 })
      execFileSync("xdotool", ["key", "--clearmodifiers", "Escape"], { timeout: 5_000 })
    } else {
      throw new Error(`Native export dialog smoke is unsupported on ${process.platform}`)
    }

    const cancelled = await browser.execute(async () => await window.__elefExportDialog)
    if (cancelled !== false) throw new Error("Cancelling the native export dialog should leave the archive unwritten")
  })
})

describe("native updater verification", () => {
  for (const mode of ["none", "older", "valid", "bad-signature", "truncated", "version-mismatch"]) {
    it(`handles ${mode} updates without changing the installed binary or work source`, async () => {
      const binaryPath = process.env.ELEF_E2E_INSTALLED_ARTIFACT || process.env.ELEF_E2E_REAL_APP_BINARY || process.env.ELEF_E2E_APP_BINARY
      const hash = async filename => createHash("sha256").update(await readFile(filename)).digest("hex")
      const sourcePath = path.join(process.env.ELEF_E2E_LIBRARY_ROOT, "E2E seed", "presentation.md")
      const original = { binary: await hash(binaryPath), source: await hash(sourcePath) }
      const response = await fetch(`http://127.0.0.1:8888/mode?value=${mode}`)
      if (!response.ok) throw new Error("Could not select the updater fixture")
      try {
        const result = await browser.execute(async () => {
          const { invoke, Channel } = window.__TAURI__.core
          const metadata = await invoke("plugin:updater|check", { timeout: 5_000 })
          if (!metadata) return { outcome: "no-update" }
          let bytesRid
          try {
            const onEvent = new Channel()
            bytesRid = await invoke("plugin:updater|download", { rid: metadata.rid, onEvent, timeout: 5_000 })
            return { outcome: "verified-download", version: metadata.version }
          } catch (error) {
            // The embedded driver reserves a top-level `error` field for its
            // own execution failures. Keep expected plugin rejection data
            // under a distinct name so it reaches the scenario assertion.
            return { outcome: "rejected", rejectionReason: String(error) }
          } finally {
            if (bytesRid !== undefined) await invoke("plugin:resources|close", { rid: bytesRid })
            await invoke("plugin:resources|close", { rid: metadata.rid })
          }
        })
        if (["none", "older"].includes(mode)) {
          if (result.outcome !== "no-update") throw new Error(`Expected no update: ${JSON.stringify(result)}`)
        } else if (mode === "valid") {
          if (result.outcome !== "verified-download" || result.version !== "0.2.0") {
            throw new Error(`Signed download did not verify: ${JSON.stringify(result)}`)
          }
        } else {
          if (result.outcome !== "rejected") throw new Error(`Unsafe update was accepted: ${JSON.stringify(result)}`)
          if (mode === "bad-signature" && !/signature/i.test(result.rejectionReason)) throw new Error(`Wrong signature rejection: ${result.rejectionReason}`)
          if (mode === "version-mismatch" && !/version/i.test(result.rejectionReason)) throw new Error(`Wrong version rejection: ${result.rejectionReason}`)
        }
        if (await hash(binaryPath) !== original.binary || await hash(sourcePath) !== original.source) {
          throw new Error("Update verification changed the installed binary or work source")
        }
        if (!(await $("#back-to-library").isExisting())) throw new Error("The application stopped responding after update verification")
      } catch (error) {
        try {
          await fetch("http://127.0.0.1:8888/mode?value=none")
        } catch (resetError) {
          console.error("Updater fixture reset also failed:", resetError.cause?.code || resetError.message)
        }
        throw new Error(error.message || String(error))
      }
      const reset = await fetch("http://127.0.0.1:8888/mode?value=none")
      if (!reset.ok) throw new Error("The updater fixture did not reset")
    })
  }

  if (process.env.ELEF_E2E_PACKAGED_UPDATES === "1") {
    it("requires native confirmation and installs signed version N without changing work bytes", async function () {
      this.timeout(180_000)
      const binaryPath = process.env.ELEF_E2E_INSTALLED_ARTIFACT || process.env.ELEF_E2E_REAL_APP_BINARY || process.env.ELEF_E2E_APP_BINARY
      const sourcePath = path.join(process.env.ELEF_E2E_LIBRARY_ROOT, "E2E seed", "presentation.md")
      const hash = async filename => createHash("sha256").update(await readFile(filename)).digest("hex")
      const original = { binary: await hash(binaryPath), source: await hash(sourcePath) }
      const response = await fetch("http://127.0.0.1:8888/mode?value=package")
      if (!response.ok) throw new Error("The packaged update fixture is missing")
      const begin = async () => {
        await browser.execute(() => {
          window.focus()
          window.__elefUpdateInstallation = window.__TAURI__.core.invoke("install_update", {
            version: "0.2.0", onProgress: new window.__TAURI__.core.Channel()
          }).then(installed => ({ installed })).catch(error => ({ rejection: error.message || String(error) }))
        })
      }
      const answer = async accept => {
        if (process.platform === "darwin") {
          answerMacNativeDialog(accept ? "OK" : "Cancel")
        } else if (process.platform === "linux") {
          const dialogId = execFileSync("xdotool", ["search", "--sync", "--onlyvisible", "--name", "^Install Elef update on quit$"], {
            encoding: "utf8", timeout: 15_000
          }).trim().split(/\s+/).at(-1)
          execFileSync("xdotool", ["windowactivate", "--sync", dialogId], { timeout: 5_000 })
          execFileSync("xdotool", ["key", "--clearmodifiers", accept ? "alt+o" : "Escape"], { timeout: 5_000 })
        } else throw new Error("Unsupported native updater confirmation platform")
      }
      try {
        await begin()
        await answer(false)
        const cancelled = await browser.execute(async () => await window.__elefUpdateInstallation)
        if (cancelled.installed !== false) throw new Error(`Native cancellation did not cancel: ${JSON.stringify(cancelled)}`)
        if (await hash(binaryPath) !== original.binary) throw new Error("Cancelling the update changed the installed application")
        await begin()
        await answer(true)
        const installed = await browser.execute(async () => await window.__elefUpdateInstallation)
        if (installed.installed !== true) throw new Error(`The signed package did not install: ${JSON.stringify(installed)}`)
        if (await hash(binaryPath) === original.binary) throw new Error("The signed update did not replace the installed application")
        if (await hash(sourcePath) !== original.source) throw new Error("Installation changed the user's work bytes")
        if (!(await $("#back-to-library").isExisting())) throw new Error("The application stopped responding after installation")
      } catch (error) {
        try {
          await fetch("http://127.0.0.1:8888/mode?value=none")
        } catch (resetError) {
          console.error("Updater fixture reset also failed:", resetError.cause?.code || resetError.message)
        }
        throw new Error(error.message || String(error))
      }
      const reset = await fetch("http://127.0.0.1:8888/mode?value=none")
      if (!reset.ok) throw new Error("The updater fixture did not reset")
    })
  }
})
