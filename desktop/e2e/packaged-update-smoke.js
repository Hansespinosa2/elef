import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"

import { desktopCommand } from "./offline-macos.js"
import { nativeQuit } from "./native-quit-smoke.js"
import { reserveWebdriverPort } from "./webdriver-port.js"

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const hash = async filename => createHash("sha256").update(await readFile(filename)).digest("hex")

function appPids() {
  try {
    return execFileSync("pgrep", ["-x", "elef-desktop"], { encoding: "utf8", timeout: 5_000 })
      .trim().split(/\s+/).filter(value => /^\d+$/.test(value)).map(Number)
  } catch (error) {
    if (error.status === 1) return []
    throw error
  }
}

async function waitUntil(check, message, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      lastError = error
    }
    await pause(100)
  }
  throw new Error(lastError ? `${message}: ${lastError.message}` : message, { cause: lastError })
}

function launchPackagedApp(env, port) {
  const command = desktopCommand(env.ELEF_E2E_APP_BINARY)
  const childEnv = { ...env, TAURI_WEBDRIVER_PORT: String(port) }
  if (childEnv.ELEF_E2E_SKIP_LIBRARY_OVERRIDE === "1") delete childEnv.ELEF_E2E_LIBRARY_ROOT
  const child = spawn(command.command, command.args, {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"]
  })
  let output = ""
  const record = chunk => { output = (output + chunk.toString()).slice(-4_000) }
  child.stdout.on("data", record)
  child.stderr.on("data", record)
  let exitResult = null
  const exited = new Promise(resolve => {
    child.once("error", error => { exitResult = { error }; resolve(exitResult) })
    child.once("exit", (code, signal) => { exitResult = { code, signal }; resolve(exitResult) })
  })
  return { child, exited, get exitResult() { return exitResult }, get output() { return output }, port }
}

async function createSession(port) {
  const response = await fetch(`http://127.0.0.1:${port}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capabilities: {
      alwaysMatch: { browserName: "tauri", "wdio:tauriServiceOptions": { windowLabel: "main" } }
    } }),
    signal: AbortSignal.timeout(60_000)
  })
  const body = await response.json()
  if (!response.ok || body.value?.error) throw new Error(body.value?.message || `WebDriver session failed: ${response.status}`)
  return body.value.sessionId
}

async function execute(port, sessionId, script, ...args) {
  const response = await fetch(`http://127.0.0.1:${port}/session/${sessionId}/execute/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script, args }),
    signal: AbortSignal.timeout(65_000)
  })
  const body = await response.json()
  if (!response.ok || body.value?.error) throw new Error(body.value?.message || `WebDriver script failed: ${response.status}`)
  return body.value
}

export async function confirmAppReady(runScript, timeoutMs = 15_000) {
  await waitUntil(() => runScript(`return Boolean(window.__TAURI__?.core?.invoke)`),
    "The packaged app bridge did not become ready", timeoutMs)
  await runScript(`return window.__TAURI__.core.invoke("confirm_app_ready")`)
}

async function updaterStats() {
  const response = await fetch("http://127.0.0.1:8888/stats")
  if (!response.ok) throw new Error("Could not inspect the loopback updater fixture")
  return response.json()
}

async function resetUpdaterStats() {
  const response = await fetch("http://127.0.0.1:8888/stats/reset", { method: "POST" })
  if (!response.ok) throw new Error("Could not reset the loopback updater fixture counters")
}

async function selectPackageUpdate(packageMode) {
  const response = await fetch(`http://127.0.0.1:8888/mode?value=${encodeURIComponent(packageMode)}`)
  if (!response.ok) throw new Error("The packaged update fixture is missing")
}

async function selectNoUpdate() {
  const response = await fetch("http://127.0.0.1:8888/mode?value=none")
  if (!response.ok) throw new Error("The updater fixture did not reset")
}

async function selectUnavailableFeed() {
  const response = await fetch("http://127.0.0.1:8888/mode?value=unavailable")
  if (!response.ok) throw new Error("The updater fixture did not become unavailable")
}

async function stageFromUpdateControl(port, sessionId) {
  await waitUntil(() => execute(port, sessionId, `
    const notice = document.querySelector("#notice");
    if (notice?.textContent.includes("Version 0.2.0 is ready")) return true;
    document.querySelector("#check-for-updates")?.click();
    return false;
  `), "The desktop update control did not stage version N", 90_000)
}

function stagedDirectory(env) {
  const cacheRoot = process.platform === "darwin"
    ? path.join(env.HOME, "Library", "Caches")
    : env.XDG_CACHE_HOME
  return path.join(cacheRoot, env.ELEF_E2E_CACHE_APP_ID || "com.elef.desktop.e2e", "updates", "pending")
}

export async function runPackagedUpdateSmoke(env, { packageMode = "package" } = {}) {
  const binaryPath = env.ELEF_E2E_INSTALLED_ARTIFACT
  const sourceFile = path.join(env.ELEF_E2E_LIBRARY_ROOT, "E2E packaged update", "presentation.md")
  const deck = path.dirname(sourceFile)
  const deckId = randomUUID()
  const originalSource = "# Before packaged update\n\nOriginal source.\n"
  const externalSource = "# External packaged update edit\n\nDisk source.\n"
  const draftSource = "# Saved during packaged update quit\n\nLocal source.\n"
  const original = { binary: await hash(binaryPath), source: originalSource }
  let app = null
  let relaunchedPid = null
  const ownedPids = new Set()

  assert.deepEqual(appPids(), [], "The packaged update smoke must not attach to another Elef process")
  await mkdir(deck, { recursive: true })
  await writeFile(sourceFile, originalSource)
  await writeFile(path.join(deck, "elef.json"), JSON.stringify({ id: deckId, schema_version: 1 }))

  try {
    // First process downloads and persists a real signed N payload, then is
    // interrupted. The second process must reuse those exact cached bytes.
    await resetUpdaterStats()
    await selectNoUpdate()
    app = launchPackagedApp(env, await reserveWebdriverPort())
    ownedPids.add(app.child.pid)
    let sessionId
    await waitUntil(async () => {
      if (app.exitResult) throw new Error(`N-1 exited during startup: ${JSON.stringify(app.exitResult)}; ${app.output}`)
      try { sessionId = await createSession(app.port); return true } catch (_error) { return false }
    }, "N-1 did not start its isolated WebDriver service", 65_000)
    await confirmAppReady(script => execute(app.port, sessionId, script))
    if (env.ELEF_E2E_PRE_RELEASE_STATE) {
      assert.equal(await readFile(env.ELEF_E2E_PRE_RELEASE_STATE, "utf8"), env.ELEF_E2E_EXPECTED_PRE_RELEASE_STATE,
        "Stable's first packaged launch must preserve the previous library-root.json bytes")
    }
    await selectPackageUpdate(packageMode)
    await stageFromUpdateControl(app.port, sessionId)
    assert.equal((await updaterStats()).artifactRequests, 1, "The first stage should download the package once")

    const pending = stagedDirectory(env)
    const metadata = JSON.parse(await readFile(path.join(pending, "metadata.json"), "utf8"))
    const payload = await readFile(path.join(pending, "payload"))
    assert.equal(metadata.version, "0.2.0")
    assert.ok(metadata.signature.length > 0)
    assert.equal(metadata.payload_size, payload.length)
    assert.equal(metadata.payload_sha256, createHash("sha256").update(payload).digest("hex"))
    assert.equal(metadata.payload_sha256, await hash(env.ELEF_E2E_UPDATE_PACKAGE))
    assert.equal(await readFile(sourceFile, "utf8"), originalSource)
    app.child.kill("SIGKILL")
    await app.exited
    assert.equal(await hash(binaryPath), original.binary, "Interrupted staging must leave N-1 installed")

    // Restart with the same isolated app cache and the same central feed.
    app = launchPackagedApp(env, await reserveWebdriverPort())
    ownedPids.add(app.child.pid)
    sessionId = null
    await waitUntil(async () => {
      if (app.exitResult) throw new Error(`N-1 did not restart: ${JSON.stringify(app.exitResult)}; ${app.output}`)
      try { sessionId = await createSession(app.port); return true } catch (_error) { return false }
    }, "N-1 did not restart with its staged update", 65_000)
    await confirmAppReady(script => execute(app.port, sessionId, script))
    await selectPackageUpdate(packageMode)
    await stageFromUpdateControl(app.port, sessionId)
    assert.equal((await updaterStats()).artifactRequests, 1, "Restart must reuse the verified payload without redownloading")

    // A feed block after staging must defer the update and leave N-1 usable.
    await selectNoUpdate()
    nativeQuit(app.child.pid)
    await waitUntil(() => app.exitResult, "A blocked update should allow an ordinary quit", 30_000)
    assert.deepEqual(app.exitResult, { code: 0, signal: null })
    assert.equal(await hash(binaryPath), original.binary, "A blocked update must not replace N-1")
    assert.equal(await readFile(sourceFile, "utf8"), originalSource)

    // Re-advertising the same immutable package stages it again after the
    // blocked cache was discarded by the safe-feed recheck.
    app = launchPackagedApp(env, await reserveWebdriverPort())
    ownedPids.add(app.child.pid)
    sessionId = null
    await waitUntil(async () => {
      if (app.exitResult) throw new Error(`N-1 did not restart after the safe-feed block: ${JSON.stringify(app.exitResult)}; ${app.output}`)
      try { sessionId = await createSession(app.port); return true } catch (_error) { return false }
    }, "N-1 did not restart after the safe-feed block", 65_000)
    await confirmAppReady(script => execute(app.port, sessionId, script))
    await selectPackageUpdate(packageMode)
    await stageFromUpdateControl(app.port, sessionId)
    assert.equal((await updaterStats()).artifactRequests, 2, "The safe package should be downloaded after unblocking")

    // A feed outage during safe-quit revalidation must defer installation,
    // allow the ordinary quit, and retain the signed cache for a later retry.
    await selectUnavailableFeed()
    nativeQuit(app.child.pid)
    await waitUntil(() => app.exitResult, "An unavailable update feed should allow an ordinary quit", 30_000)
    assert.deepEqual(app.exitResult, { code: 0, signal: null })
    assert.equal(await hash(binaryPath), original.binary, "A feed outage must leave N-1 installed")
    assert.equal(await readFile(sourceFile, "utf8"), originalSource)
    const retained = JSON.parse(await readFile(path.join(stagedDirectory(env), "metadata.json"), "utf8"))
    assert.equal(retained.version, metadata.version, "A feed outage must retain the verified staged update")

    // Restore the feed and prove the retained bytes avoid another download.
    await selectPackageUpdate(packageMode)
    app = launchPackagedApp({
      ...env,
      ELEF_E2E_INTERRUPT_UPDATE_AFTER_STAGE_INSTALL: "1"
    }, await reserveWebdriverPort())
    ownedPids.add(app.child.pid)
    sessionId = null
    await waitUntil(async () => {
      if (app.exitResult) throw new Error(`N-1 did not restart after the feed outage: ${JSON.stringify(app.exitResult)}; ${app.output}`)
      try { sessionId = await createSession(app.port); return true } catch (_error) { return false }
    }, "N-1 did not restart after the feed outage", 65_000)
    await confirmAppReady(script => execute(app.port, sessionId, script))
    await stageFromUpdateControl(app.port, sessionId)
    assert.equal((await updaterStats()).artifactRequests, 2, "Feed recovery should reuse the retained verified archive")

    await waitUntil(() => execute(app.port, sessionId,
      `return Boolean(document.querySelector('[aria-label="Edit E2E packaged update"]'))`),
    "The packaged smoke deck did not appear")
    await execute(app.port, sessionId, `document.querySelector('[aria-label="Edit E2E packaged update"]').click(); return true`)
    await waitUntil(() => execute(app.port, sessionId,
      `return document.querySelector('#desktop-editor-form')?.dataset.loadedDeckId === arguments[0]`, deckId),
    "The packaged smoke deck did not open")

    const changed = await execute(app.port, sessionId, `
      window.__elefSaveTestHooks.pause();
      const controller = document.querySelector('#desktop-editor-field').editorController;
      controller.replaceRange(arguments[0], 0, controller.value.length);
      return controller.sourceValue;
    `, draftSource)
    assert.equal(changed, draftSource)
    await writeFile(sourceFile, externalSource)
    nativeQuit(app.child.pid)
    await waitUntil(() => execute(app.port, sessionId,
      `return document.querySelector('#conflict-dialog')?.open === true`),
    "An unsafe save must leave the app open with its conflict visible", 20_000)
    assert.equal(app.exitResult, null, "The failed save must defer activation and keep N-1 open")
    assert.equal(await hash(binaryPath), original.binary, "The app must not install while the save is conflicted")
    assert.equal(await readFile(sourceFile, "utf8"), externalSource, "The external edit must remain intact")
    assert.equal(await execute(app.port, sessionId,
      `return document.querySelector('#desktop-editor-field').editorController.sourceValue`), draftSource,
    "The local unsaved draft must remain available for conflict resolution")

    await execute(app.port, sessionId, `document.querySelector('#keep-local-version').click(); return true`)
    await waitUntil(async () => await readFile(sourceFile, "utf8") === draftSource,
      "Choosing the local version should save the user's source")
    nativeQuit(app.child.pid)
    await waitUntil(() => app.exitResult, "The interrupted update did not reach its test boundary", 180_000)
    assert.deepEqual(app.exitResult, { code: 86, signal: null }, "The fixture should interrupt after installing only the staged copy")
    assert.equal(await hash(binaryPath), original.binary, "An interrupted install must preserve N-1")
    assert.equal(await readFile(sourceFile, "utf8"), draftSource, "The interrupted install must preserve the saved library bytes")

    // A fresh process must reuse the cached signed payload and finish the
    // atomic activation on a later ordinary quit.
    app = launchPackagedApp(env, await reserveWebdriverPort())
    ownedPids.add(app.child.pid)
    sessionId = null
    await waitUntil(async () => {
      if (app.exitResult) throw new Error(`N-1 did not restart after interrupted installation: ${JSON.stringify(app.exitResult)}; ${app.output}`)
      try { sessionId = await createSession(app.port); return true } catch (_error) { return false }
    }, "N-1 did not restart after interrupted installation", 65_000)
    await confirmAppReady(script => execute(app.port, sessionId, script))
    await selectPackageUpdate(packageMode)
    await stageFromUpdateControl(app.port, sessionId)
    assert.equal((await updaterStats()).artifactRequests, 2, "Interrupted installation should retain the verified archive")

    nativeQuit(app.child.pid)
    await waitUntil(() => app.exitResult, "The safe update quit did not finish", 180_000)
    if (app.exitResult.error) throw app.exitResult.error
    assert.deepEqual(app.exitResult, { code: 0, signal: null }, "The updater should relaunch only after successful save")
    assert.notEqual(await hash(binaryPath), original.binary, "The signed N archive should replace N-1 on ordinary quit")
    assert.equal(await readFile(sourceFile, "utf8"), draftSource, "The update must preserve the saved library bytes")

    await waitUntil(() => {
      const pid = appPids().find(candidate => candidate !== app.child.pid)
      if (!pid) return false
      relaunchedPid = pid
      ownedPids.add(pid)
      return true
    }, "The installed N application did not relaunch", 65_000)
    let relaunchedSession
    await waitUntil(async () => {
      try { relaunchedSession = await createSession(app.port); return true } catch (_error) { return false }
    }, "The relaunched N application did not start", 65_000)
    await confirmAppReady(script => execute(app.port, relaunchedSession, script))
    const relaunchedState = await execute(app.port, relaunchedSession, `
      return {
        version: await window.__TAURI__.core.invoke("plugin:app|version"),
        source: (await window.__TAURI__.core.invoke("open_deck", { id: arguments[0] })).source
      };
    `, deckId)
    assert.equal(relaunchedState.version, "0.2.0")
    assert.equal(relaunchedState.source, draftSource)
    if (env.ELEF_E2E_PRE_RELEASE_STATE) {
      assert.equal(await readFile(env.ELEF_E2E_PRE_RELEASE_STATE, "utf8"), env.ELEF_E2E_EXPECTED_PRE_RELEASE_STATE,
        "The N-1 to N update must preserve the previous Stable library selection bytes")
    }
    nativeQuit(relaunchedPid)
    await waitUntil(() => !appPids().includes(relaunchedPid), "The relaunched N application did not close cleanly", 20_000)
    process.stdout.write("Packaged N-1 → N safe-quit update smoke passed.\n")
  } catch (error) {
    throw new Error(`Packaged update smoke failed: ${error.message}; app: ${app?.output || "not started"}`, { cause: error })
  } finally {
    await selectNoUpdate().catch(() => {})
    if (app && !app.exitResult) app.child.kill("SIGTERM")
    for (const pid of appPids()) {
      if (ownedPids.has(pid)) {
        try { process.kill(pid, "SIGTERM") } catch (_error) {}
      }
    }
    await pause(500)
    await rm(deck, { recursive: true, force: true })
  }
}
