import { $, browser } from "@wdio/globals"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const libraryRoot = () => process.env.ELEF_E2E_LIBRARY_ROOT
const deckPath = title => path.join(libraryRoot(), title)
const sourcePath = title => path.join(deckPath(title), "presentation.md")

async function seedDeck(title, source) {
  await mkdir(deckPath(title), { recursive: true })
  await writeFile(sourcePath(title), source)
  await writeFile(path.join(deckPath(title), "elef.json"), JSON.stringify({ id: randomUUID(), schema_version: 1 }))
}

async function showLibrary() {
  if (!(await $("#library-view").isDisplayed())) {
    await $("#back-to-library").click()
    await $("#library-view").waitForDisplayed()
  }
}

async function refreshLibrary() {
  await showLibrary()
  await $("#refresh-library").click()
}

async function openDeck(title) {
  await showLibrary()
  await $("#show-deck-list").click()
  const card = $(`[aria-label="Edit ${title}"]`)
  await card.waitForDisplayed({ timeout: 10_000 })
  await card.click()
  await browser.waitUntil(async () => browser.execute(expected => {
    const form = document.querySelector("#desktop-editor-form")
    return document.querySelector("#deck-title")?.textContent === expected
      && form?.dataset.loadedDeckId === document.querySelector("#deck-id")?.textContent
      && !document.querySelector("#deck-view")?.hidden
  }, title), {
    timeout: 10_000,
    timeoutMsg: `The ${title} deck did not finish opening`
  })
}

async function replaceSource(source) {
  const sourceMode = await $("#source-mode")
  await sourceMode.waitForDisplayed()
  if ((await sourceMode.getAttribute("aria-pressed")) !== "true") await sourceMode.click()
  await browser.waitUntil(async () =>
    (await $("#desktop-editor-form").getAttribute("data-editor-mode")) === "source", {
    timeout: 5_000,
    timeoutMsg: "The source editor did not finish restoring after the mode switch"
  })
  const editor = await $("#deck-source-editor .cm-content")
  await editor.waitForDisplayed()
  const updated = await browser.execute(nextSource => {
    const controller = document.querySelector("#desktop-editor-field")?.editorController
    if (!controller) return false
    controller.replaceRange(nextSource, 0, controller.value.length)
    controller.setSelectionRange(nextSource.length)
    return controller.sourceValue
  }, source)
  assert.equal(updated, source)
}

async function readEditorSource() {
  return browser.execute(() => document.querySelector("#desktop-editor-field")?.editorController?.sourceValue ?? "")
}

async function saveStatus() {
  return browser.execute(() => window.__elefSaveTestHooks?.saveStatus())
}

async function waitForQuiescent(timeoutMsg = "The desktop editor did not finish saving") {
  await browser.waitUntil(async () => (await saveStatus()) === "clean", { timeout: 10_000, timeoutMsg })
}

async function readDisk(title) {
  return readFile(sourcePath(title), "utf8")
}

async function waitForDisk(title, expected, timeout = 10_000) {
  const startedAt = Date.now()
  await browser.waitUntil(async () => {
    try {
      return (await readDisk(title)) === expected
    } catch (_error) {
      return false
    }
  }, { timeout, timeoutMsg: `Disk bytes for ${title} did not reach the expected source` })
  return Date.now() - startedAt
}

async function deckId() {
  return browser.execute(() => document.querySelector("#deck-id")?.textContent)
}

async function historySnapshots(title) {
  const id = await deckId()
  void title
  const dir = path.join(libraryRoot(), ".elef-history", id)
  const files = await readdir(dir)
  const entries = []
  for (const file of files.filter(name => name.endsWith(".snap"))) {
    entries.push({ file, bytes: await readFile(path.join(dir, file), "utf8") })
  }
  return entries
}

// External delivery styles (P02-09): in-place edit, git-style temp rename,
// and sync-tool delete + recreate.
async function writeDirect(title, source) {
  await writeFile(sourcePath(title), source)
}

async function writeRename(title, source) {
  const temp = path.join(deckPath(title), ".e2e-external-tmp")
  await writeFile(temp, source)
  await rename(temp, sourcePath(title))
}

async function writeRecreate(title, source) {
  const target = sourcePath(title)
  await writeFile(path.join(deckPath(title), ".e2e-external-hold"), source)
  await rename(path.join(deckPath(title), ".e2e-external-hold"), target + ".new")
  const { rm } = await import("node:fs/promises")
  await rm(target, { force: true })
  await rename(target + ".new", target)
}

function focusDesktopWindow() {
  const pids = execFileSync("pgrep", ["-x", "elef-desktop"], { encoding: "utf8", timeout: 5_000 })
    .trim().split(/\s+/).filter(Boolean)
  assert.equal(pids.length, 1)
  if (process.platform === "linux") {
    const windowId = execFileSync("xdotool", ["search", "--sync", "--onlyvisible", "--pid", pids[0]], {
      encoding: "utf8", timeout: 5_000
    }).trim().split(/\s+/)[0]
    assert.ok(windowId)
    execFileSync("xdotool", ["windowactivate", "--sync", windowId], { timeout: 5_000 })
    return
  }
  if (process.platform === "darwin") {
    execFileSync("osascript", ["-e", `tell application "System Events"
      set frontmost of (first application process whose unix id is ${pids[0]}) to true
    end tell`], { timeout: 5_000 })
    return
  }
  throw new Error(`Native window activation is unsupported on ${process.platform}`)
}

const BASELINE = "# Quiet baseline\n\nSeed paragraph.\n"

describe("desktop quiet save", () => {
  before(async () => {
    await seedDeck("E2E quiet main", BASELINE)
    await seedDeck("E2E quiet second", "# Quiet second\n\nAnother deck.\n")
    await seedDeck("E2E quiet merge", "alpha\nbeta\n")
    await seedDeck("E2E quiet conflict", "same\nlines\nhere\n")
    await seedDeck("E2E quiet failure", "# Quiet failure\n\nSeed paragraph.\n")
  })

  it("shows no save button, status, unsaved marker, or retry on desktop", async () => {
    await refreshLibrary()
    await openDeck("E2E quiet main")
    const chrome = await browser.execute(() => ({
      saveState: document.querySelector("#save-state")?.textContent ?? null,
      retrySave: document.querySelector("#retry-save")?.textContent ?? null,
      saveButtonVisible: (() => {
        const button = document.querySelector("[data-editor-view-target='saveButton']")
        return Boolean(button && !button.hidden && button.offsetParent !== null)
      })(),
      restoreDraftHidden: document.querySelector("#restore-local-draft")?.hidden ?? null,
      conflictDialogPresent: Boolean(document.querySelector("#conflict-dialog"))
    }))
    assert.equal(chrome.saveState, null)
    assert.equal(chrome.retrySave, null)
    assert.equal(chrome.saveButtonVisible, false)
    assert.equal(chrome.restoreDraftHidden, true)
    assert.equal(chrome.conflictDialogPresent, true)
  })

  it("persists changed text to disk within 2.5 s after the last edit", async () => {
    await openDeck("E2E quiet main")
    const edited = `${BASELINE}\nTimed quiet-save line.\n`
    await replaceSource(edited)
    const startedAt = Date.now()
    const diskMs = await waitForDisk("E2E quiet main", edited)
    await waitForQuiescent()
    assert.ok(diskMs < 2500, `Quiet save took ${diskMs} ms to reach disk (budget 2500 ms)`)
    assert.ok(Date.now() - startedAt < 10_000)
  })

  it("flushes dirty edits immediately on blur", async () => {
    await openDeck("E2E quiet main")
    const edited = `${BASELINE}\nBlurred line.\n`
    await replaceSource(edited)
    await browser.execute(() => window.dispatchEvent(new Event("blur")))
    const diskMs = await waitForDisk("E2E quiet main", edited)
    await waitForQuiescent()
    assert.ok(diskMs < 1500, `Blur flush took ${diskMs} ms to reach disk`)
  })

  it("flushes dirty edits immediately on Cmd-or-Ctrl+S", async () => {
    await openDeck("E2E quiet main")
    const edited = `${BASELINE}\nAccelerator line.\n`
    await replaceSource(edited)
    focusDesktopWindow()
    if (process.platform === "linux") {
      execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+s"], { timeout: 5_000 })
    } else {
      execFileSync("osascript", ["-e", 'tell application "System Events" to keystroke "s" using {command down}'], { timeout: 5_000 })
    }
    const diskMs = await waitForDisk("E2E quiet main", edited)
    await waitForQuiescent()
    assert.ok(diskMs < 1500, `Accelerator flush took ${diskMs} ms to reach disk`)
  })

  it("flushes dirty edits before switching decks", async () => {
    await openDeck("E2E quiet main")
    const edited = `${BASELINE}\nPre-switch line.\n`
    await replaceSource(edited)
    await openDeck("E2E quiet second")
    assert.equal(await readDisk("E2E quiet main"), edited)
    await waitForQuiescent()
  })

  it("reloads clean external edits silently for every delivery style", async () => {
    await openDeck("E2E quiet main")
    await waitForQuiescent()
    const styles = { direct: writeDirect, rename: writeRename, recreate: writeRecreate }
    for (const [name, write] of Object.entries(styles)) {
      const external = `${BASELINE}\nExternal ${name} line.\n`
      await write("E2E quiet main", external)
      await browser.waitUntil(async () => (await readEditorSource()) === external, {
        timeout: 10_000,
        timeoutMsg: `Clean ${name} external edit did not reload silently`
      })
      await waitForQuiescent()
      assert.equal(await readDisk("E2E quiet main"), external)
      const conflictOpen = await browser.execute(() => document.querySelector("#conflict-dialog")?.open === true)
      assert.equal(conflictOpen, false)
    }
  })

  it("merges dirty non-overlapping external edits after snapshotting both sides", async () => {
    await openDeck("E2E quiet merge")
    await waitForQuiescent()
    await replaceSource("ALPHA\nbeta\n")
    await writeDirect("E2E quiet merge", "alpha\nBETA\n")
    await browser.waitUntil(async () => (await readEditorSource()) === "ALPHA\nBETA\n", {
      timeout: 10_000,
      timeoutMsg: "Non-overlapping external edit did not merge silently"
    })
    await waitForQuiescent()
    assert.equal(await readDisk("E2E quiet merge"), "ALPHA\nBETA\n")
    const snapshots = await historySnapshots("E2E quiet merge")
    const byReason = Object.fromEntries(snapshots.map(entry => [
      entry.file.slice(entry.file.indexOf("-") + 1, -".snap".length),
      entry.bytes
    ]))
    assert.equal(byReason["pre-merge"], "ALPHA\nbeta\n")
    assert.equal(byReason["external-change"], "alpha\nBETA\n")
  })

  it("merges dirty non-overlapping git-style replacements", async () => {
    await openDeck("E2E quiet merge")
    await browser.waitUntil(async () => (await readEditorSource()) === "ALPHA\nBETA\n", {
      timeout: 10_000,
      timeoutMsg: "The merge deck did not hold the previously merged source"
    })
    await replaceSource("ALPHA\nBETA\nGAMMA\n")
    await writeRename("E2E quiet merge", "ZETA\nALPHA\nBETA\n")
    await browser.waitUntil(async () => (await readEditorSource()) === "ZETA\nALPHA\nBETA\nGAMMA\n", {
      timeout: 10_000,
      timeoutMsg: "Git-style external replacement did not merge silently"
    })
    await waitForQuiescent()
    assert.equal(await readDisk("E2E quiet merge"), "ZETA\nALPHA\nBETA\nGAMMA\n")
  })

  it("routes overlapping edits to the conflict dialog and preserves both sides", async () => {
    await openDeck("E2E quiet conflict")
    await waitForQuiescent()
    await replaceSource("LOCAL\nlines\nhere\n")
    await writeDirect("E2E quiet conflict", "EXTERNAL\nlines\nhere\n")
    await $("#conflict-dialog").waitForDisplayed({ timeout: 10_000 })
    assert.equal(await readEditorSource(), "LOCAL\nlines\nhere\n")
    assert.equal(await $("#conflict-local").getText(), "LOCAL\nlines\nhere\n")
    assert.equal(await $("#conflict-disk").getText(), "EXTERNAL\nlines\nhere\n")
    const snapshots = await historySnapshots("E2E quiet conflict")
    const external = snapshots.find(entry => entry.file.endsWith("-external-change.snap"))
    assert.ok(external)
    assert.equal(external.bytes, "EXTERNAL\nlines\nhere\n")
    await $("#keep-local-version").click()
    await waitForQuiescent()
    assert.equal(await readDisk("E2E quiet conflict"), "LOCAL\nlines\nhere\n")
  })

  it("never auto-loads suspicious external changes", async () => {
    await openDeck("E2E quiet conflict")
    await browser.waitUntil(async () => (await readEditorSource()) === "LOCAL\nlines\nhere\n", {
      timeout: 10_000,
      timeoutMsg: "The conflict deck did not hold the previously kept local source"
    })
    const local = "LOCAL line\n".repeat(25)
    await replaceSource(local)
    await writeDirect("E2E quiet conflict", "x\n")
    await $("#conflict-dialog").waitForDisplayed({ timeout: 10_000 })
    assert.equal(await readEditorSource(), local)
    await $("#keep-local-version").click()
    await waitForQuiescent()
    assert.equal(await readDisk("E2E quiet conflict"), local)
  })

  it("retries failed saves automatically without a modal dialog", async () => {
    await openDeck("E2E quiet failure")
    await waitForQuiescent()
    const target = `${BASELINE}\nRecovered line.\n`
    await replaceSource(target)
    // Hide the deck directory so staged saves fail even for privileged users.
    const held = `${deckPath("E2E quiet failure")}.held`
    await rename(deckPath("E2E quiet failure"), held)
    try {
      await browser.waitUntil(async () => (await saveStatus()) !== "clean", {
        timeout: 10_000,
        timeoutMsg: "The failed save did not leave the session dirty"
      })
      await new Promise(resolve => setTimeout(resolve, 3500))
      await assert.rejects(readDisk("E2E quiet failure"))
      const dialogOpen = await browser.execute(() => document.querySelector("#conflict-dialog")?.open === true)
      assert.equal(dialogOpen, false)
    } finally {
      await rename(held, deckPath("E2E quiet failure"))
    }
    await waitForDisk("E2E quiet failure", target)
    await waitForQuiescent()
    assert.equal(await readDisk("E2E quiet failure"), target)
  })
})
