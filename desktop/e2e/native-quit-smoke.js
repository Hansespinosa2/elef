import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { desktopCommand } from "./offline-macos.js"
import { reserveWebdriverPort } from "./webdriver-port.js"

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastScriptTimeout
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      if (!/script execution timed out/i.test(error?.message || "")) throw error
      lastScriptTimeout = error
    }
    await pause(100)
  }
  throw new Error(lastScriptTimeout ? `${message}: ${lastScriptTimeout.message}` : message, { cause: lastScriptTimeout })
}

export function nativeQuit(pid) {
  if (process.platform === "linux") {
    const windowId = execFileSync("xdotool", ["search", "--sync", "--onlyvisible", "--pid", String(pid)], {
      encoding: "utf8", timeout: 5_000
    }).trim().split(/\s+/)[0]
    assert.ok(windowId, "The application must own a visible CI window")
    execFileSync("xdotool", ["windowactivate", "--sync", windowId], { timeout: 5_000 })
    execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+q"], { timeout: 5_000 })
  } else if (process.platform === "darwin") {
    execFileSync("osascript", ["-e", `tell application "System Events"
      tell (first application process whose unix id is ${pid})
        set frontmost to true
        keystroke "q" using {command down}
      end tell
    end tell`], { timeout: 5_000 })
  } else throw new Error(`Native Quit is unsupported on ${process.platform}`)
}

// Only runs on CI's isolated native display. Use the actual embedded WebDriver
// to wait for frontend readiness and stage real editor changes, then send the
// OS shortcut and inspect process exit and on-disk bytes independently.
export async function runNativeQuitSmokes(env) {
  for (const mode of ["clean", "dirty", "conflict"]) {
    const id = randomUUID()
    const title = `E2E native Quit ${mode}`
    const deck = path.join(env.ELEF_E2E_LIBRARY_ROOT, title)
    const sourceFile = path.join(deck, "presentation.md")
    const original = "# Before native Quit\n\nOriginal source.\n"
    const draft = "# Unsaved native Quit\n\nLocal source.\n"
    const external = "# External native Quit\n\nExternal source.\n"
    const smokeEnv = { ...env, TAURI_WEBDRIVER_PORT: await reserveWebdriverPort() }
    await mkdir(deck)
    await writeFile(sourceFile, original)
    await writeFile(path.join(deck, "elef.json"), JSON.stringify({ id, schema_version: 1 }))
    const restricted = desktopCommand(env.ELEF_E2E_APP_BINARY)
    const app = spawn(restricted.command, restricted.args, { env: smokeEnv, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    const record = chunk => { output = (output + chunk.toString()).slice(-4_000) }
    app.stdout.on("data", record)
    app.stderr.on("data", record)
    let exitResult = null
    const exited = new Promise(resolve => {
      app.once("error", error => { exitResult = { error }; resolve(exitResult) })
      app.once("exit", (code, signal) => { exitResult = { code, signal }; resolve(exitResult) })
    })
    const endpoint = `http://127.0.0.1:${smokeEnv.TAURI_WEBDRIVER_PORT}`
    const request = async (suffix, body) => {
      const response = await fetch(endpoint + suffix, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60_000)
      })
      const { value } = await response.json()
      if (!response.ok || value?.error) throw new Error(value?.message || `WebDriver request failed: ${response.status}`)
      return value
    }
    let sessionId
    let stage = "starting the application"
    const execute = (script, ...args) => request(`/session/${sessionId}/execute/sync`, { script, args })
    try {
      stage = "starting the embedded WebDriver session"
      await waitFor(async () => {
        if (exitResult) throw new Error("Elef exited before creating a native smoke session")
        try {
          const session = await request("/session", { capabilities: {
            alwaysMatch: { browserName: "tauri", "wdio:tauriServiceOptions": { windowLabel: "main" } }
          } })
          sessionId = session.sessionId
          assert.ok(sessionId)
          return true
        } catch (error) {
          if (error.cause?.code === "ECONNREFUSED") return false
          throw error
        }
      }, "The native Quit smoke driver did not start", 65_000)
      await request(`/session/${sessionId}/timeouts`, { script: 2_000 })
      stage = "waiting for editor readiness"
      await waitFor(() => {
        if (exitResult) throw new Error(`Elef exited before the editor connected: ${JSON.stringify(exitResult)}`)
        return execute(`return Boolean(document.querySelector('[aria-label="Edit ${title}"]')
          && document.querySelector('#desktop-editor-field')?.editorController?.editorReady)`)
      }, "The native Quit smoke frontend did not finish loading", 65_000)
      await request(`/session/${sessionId}/timeouts`, { script: 60_000 })
      stage = "opening the smoke deck"
      await execute(`document.querySelector('[aria-label="Edit ${title}"]').click(); return true`)
      stage = "waiting for the deck to finish opening"
      await waitFor(() => execute(`const form = document.querySelector('#desktop-editor-form');
        return form?.dataset.loadedDeckId === arguments[0] && !document.querySelector('#deck-view').hidden`, id),
      "The native Quit smoke deck did not finish opening")
      if (mode !== "clean") {
        stage = "staging an unsaved editor draft"
        const changed = await execute(`window.__elefSaveTestHooks.pause();
          const controller = document.querySelector('#desktop-editor-field').editorController;
          controller.replaceRange(arguments[0], 0, controller.value.length);
          return controller.sourceValue`, draft)
        assert.equal(changed, draft)
        assert.equal(await readFile(sourceFile, "utf8"), original, "The draft must still be unsaved before Quit")
        if (mode === "conflict") {
          stage = "staging the external edit"
          await writeFile(sourceFile, external)
        }
      }
      stage = "sending the native Quit shortcut"
      nativeQuit(app.pid)
      if (mode === "conflict") {
        stage = "waiting for Quit to surface the conflict"
        await waitFor(() => execute("return document.querySelector('#conflict-dialog').open"),
          "Native Quit did not surface the external-change conflict")
        assert.equal(exitResult, null, "A conflict must keep the native process alive")
        assert.equal(await readFile(sourceFile, "utf8"), external, "Quit must not overwrite external bytes")
        stage = "checking the preserved editor draft"
        assert.equal(await execute("return document.querySelector('#desktop-editor-field').editorController.sourceValue"), draft)
        stage = "resolving the native Quit conflict"
        await execute("document.querySelector('#use-disk-version').click(); return true")
        stage = "waiting for conflict resolution"
        await waitFor(() => execute("return !document.querySelector('#conflict-dialog').open && document.querySelector('#desktop-editor-field').editorController.sourceValue === arguments[0]", external),
          "The native Quit conflict did not finish resolving")
        stage = "sending the resolved native Quit shortcut"
        nativeQuit(app.pid)
      }
      stage = "waiting for a clean process exit"
      await waitFor(() => Boolean(exitResult), "Elef did not exit after the native Quit shortcut", 10_000)
      if (exitResult.error) throw exitResult.error
      assert.deepEqual(exitResult, { code: 0, signal: null }, "Native Quit must exit cleanly")
      assert.equal(await readFile(sourceFile, "utf8"), mode === "dirty" ? draft : mode === "conflict" ? external : original)
      process.stdout.write(`Native ${mode} Quit smoke passed.\n`)
    } catch (error) {
      let frontendState = null
      if (sessionId) {
        try {
          frontendState = await execute(`const field = document.querySelector('#desktop-editor-field');
            const target = document.querySelector('[aria-label="Edit ${title}"]');
            const hooks = window.__elefPerformanceTestHooks;
            return {
              editorReady: field?.editorController?.editorReady ?? null,
              editorController: Boolean(field?.editorController),
              editorFieldControllers: field?.dataset.controller || null,
              editorFormControllers: document.querySelector('#desktop-editor-form')?.dataset.controller || null,
              controllerErrors: globalThis.__elefE2EControllerErrors || [],
              noticeText: document.querySelector('#notice')?.textContent || "",
              stimulusIdentifiers: Object.keys(window.Stimulus?.controllers || {}),
              libraryViewHidden: document.querySelector('#library-view')?.hidden ?? null,
              targetFound: Boolean(target),
              nativeReadyAt: hooks?.nativeReadyAt || null,
              bootstrapStages: hooks?.bootstrapStages?.() || []
            }`)
        } catch (probeError) {
          frontendState = { probeError: probeError.message }
        }
      }
      throw new Error(`Native ${mode} Quit while ${stage}: ${error.message}; process: ${JSON.stringify(exitResult)}; frontend: ${JSON.stringify(frontendState)}; desktop output: ${output}`)
    } finally {
      if (!exitResult) {
        app.kill("SIGTERM")
        await Promise.race([exited, pause(1_000)])
        if (!exitResult) { app.kill("SIGKILL"); await exited }
      }
      // Let the native webview and driver release resources before the next fresh launch.
      await pause(1_000)
      await rm(deck, { recursive: true, force: true })
    }
  }
}
