import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { desktopCommand } from "./offline-macos.js"
import { readWebdriverValue, reserveWebdriverPort, webdriverElementPath } from "./webdriver-port.js"
import { percentile95 } from "../../app/javascript/lib/performance_measurement.js"
import { LIBRARY_RENDER_BATCH_SIZE } from "../../app/javascript/lib/incremental_list.js"
import { parseLaunchCount } from "./native-benchmark-config.js"

const binary = process.argv[process.argv.indexOf("--binary") + 1]
const reportOnly = process.argv.includes("--report-runner")
const launchCount = parseLaunchCount(process.argv.slice(2))
if (!process.argv.includes("--binary") || !binary || !path.isAbsolute(binary)) {
  throw new Error("Provide --binary with the absolute path to a release build with the webdriver feature.")
}
if (process.platform === "linux" && (!process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) {
  throw new Error("Run the native benchmark on an isolated headless X display.")
}
const output = path.resolve(process.env.ELEF_PERFORMANCE_REPORT || `desktop/target/native-performance-${process.platform}.json`)
const temporary = await mkdtemp(path.join(os.tmpdir(), "elef-performance-"))
const library = path.join(temporary, "Elef")
const deckId = randomUUID()
const source = Array.from({ length: 100 }, (_, index) =>
  `# Slide ${index + 1}\n\nNotes with $x^2$ and **emphasis**.\n\n\`\`\`javascript\nconst slide = ${index + 1}\n\`\`\`\n`
).join("\n---\n")
const samples = { coldStart: [], open100Slides: [], warmLibrary: [] }
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const report = { platform: process.platform, architecture: process.arch, release: os.release(),
  protocol: `${launchCount} fresh release processes; 1000 deck index; first ${LIBRARY_RENDER_BATCH_SIZE} cards; one 50 MiB deck; painted operation timings`,
  samples, inputPreservedRuns: 0 }
report.renderedLibraryCards = []
report.bootstrapStageRuns = []
report.frontendNavigationRuns = []
report.openTraceRuns = []
report.previewTraceRuns = []

try {
  await mkdir(library)
  for (let index = 0; index < 1000; index += 1) {
    const folder = path.join(library, index === 0 ? "0000 Large presentation" : `Deck ${String(index).padStart(4, "0")}`)
    await mkdir(folder)
    await writeFile(path.join(folder, "presentation.md"), index === 0 ? source : `# Deck ${index}\n\nNotes.\n`)
    await writeFile(path.join(folder, "elef.json"), JSON.stringify({ id: index === 0 ? deckId : randomUUID(), schema_version: 1 }))
    if (index === 0) {
      await mkdir(path.join(folder, "images"))
      // Deck size includes an opaque, unreferenced local asset. Opening the
      // deck must not read every image into IPC or memory merely to list it.
      await writeFile(path.join(folder, "images/scale-fixture.bin"), Buffer.alloc(50 * 1024 * 1024))
    }
  }
  for (let run = 0; run < launchCount; run += 1) {
    const folder = path.join(library, "0000 Large presentation")
    await writeFile(path.join(folder, "presentation.md"), source)
    const env = { ...process.env, ELEF_E2E_LIBRARY_ROOT: library, TAURI_WEBDRIVER_PORT: await reserveWebdriverPort() }
    const command = desktopCommand(binary)
    const launchedAt = Date.now()
    const app = spawn(command.command, command.args, { env, stdio: ["ignore", "pipe", "pipe"] })
    let exitResult = null
    let backendOutput = ""
    const record = chunk => { backendOutput = (backendOutput + chunk.toString()).slice(-2_000) }
    app.stdout.on("data", record)
    app.stderr.on("data", record)
    const exited = new Promise(resolve => {
      app.once("error", error => { exitResult = { error }; resolve(exitResult) })
      app.once("exit", (code, signal) => { exitResult = { code, signal }; resolve(exitResult) })
    })
    const request = async (route, body) => {
      const response = await fetch(`http://127.0.0.1:${env.TAURI_WEBDRIVER_PORT}${route}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000)
      })
      return readWebdriverValue(response)
    }
    let session
    let operation = "WebDriver session startup"
    try {
      const deadline = Date.now() + 65_000
      while (!session && Date.now() < deadline) {
        if (exitResult) throw new Error("The release process exited before its benchmark session")
        try {
          session = await request("/session", { capabilities: {
            alwaysMatch: { browserName: "tauri", "wdio:tauriServiceOptions": { windowLabel: "main" } }
          } })
        } catch (error) {
          if (error.cause?.code !== "ECONNREFUSED") throw error
          await pause(50)
        }
      }
      assert.ok(session?.sessionId, "Release benchmark session must start")
      await request(`/session/${session.sessionId}/timeouts`, { script: 2_000 })
      const execute = (script, ...args) => request(`/session/${session.sessionId}/execute/sync`, { script, args })
      let interactiveAt
      operation = "frontend startup acknowledgement"
      while (!interactiveAt && Date.now() < deadline) {
        try {
          interactiveAt = await execute("return window.__elefPerformanceTestHooks?.interactiveAt || null")
        } catch (error) {
          if (!/script execution timed out/i.test(error.message)) throw error
        }
        if (!interactiveAt) await pause(50)
      }
      assert.ok(interactiveAt, "The release frontend must acknowledge completed startup")
      await request(`/session/${session.sessionId}/timeouts`, { script: 60_000 })
      samples.coldStart.push(interactiveAt - launchedAt)
      report.frontendNavigationRuns.push(await execute("return window.__elefPerformanceTestHooks.navigationTiming()"))
      let nativeReadyAt
      while (!nativeReadyAt && Date.now() < deadline) {
        nativeReadyAt = await execute("return window.__elefPerformanceTestHooks?.nativeReadyAt || null")
        if (!nativeReadyAt) await pause(50)
      }
      assert.ok(nativeReadyAt, "The release frontend must finish editor initialization before acknowledging the installed update")
      const startupStagesJson = await execute("return JSON.stringify(window.__elefPerformanceTestHooks.bootstrapStages())")
      report.bootstrapStageRuns.push(JSON.parse(startupStagesJson))
      operation = "1,000-deck library refresh"
      const listed = await execute("return await window.__elefPerformanceTestHooks.list()")
      assert.equal(listed.result.total, 1000)
      assert.equal(listed.result.rendered, Math.min(LIBRARY_RENDER_BATCH_SIZE, listed.result.total))
      report.renderedLibraryCards.push(listed.result.rendered)
      samples.warmLibrary.push(listed.milliseconds)
      operation = "100-slide deck open and render"
      const opened = await execute("return await window.__elefPerformanceTestHooks.open(arguments[0])", deckId)
      assert.equal(opened.result.id, deckId)
      assert.equal(opened.result.slides, 100)
      samples.open100Slides.push(opened.milliseconds)
      report.openTraceRuns.push(opened.result.openTrace)
      report.previewTraceRuns.push(opened.result.previewTrace)
      operation = "autosave while typing"
      const text = "Input preserved 😀 日本語"
      await execute("return window.__elefPerformanceTestHooks.startTypingDuringSave(arguments[0])", text)
      const editorElement = await request(webdriverElementPath(session.sessionId), {
        using: "css selector", value: ".source-field .cm-content"
      })
      const editorElementId = editorElement["element-6066-11e4-a52e-4f735466cecf"] || editorElement.ELEMENT
      assert.ok(editorElementId, "The source editor must be available for native keyboard input")
      await request(webdriverElementPath(session.sessionId, editorElementId), { text })
      const typed = await execute("return await window.__elefPerformanceTestHooks.finishTypingDuringSave()")
      assert.equal(typed, source + "\nInput preserved 😀 日本語")
      assert.equal(await readFile(path.join(folder, "presentation.md"), "utf8"), typed)
      report.inputPreservedRuns += 1
      await execute("return window.__elefPerformanceTestHooks.close()")
      const quitDeadline = Date.now() + 10_000
      while (!exitResult && Date.now() < quitDeadline) await pause(50)
      assert.deepEqual(exitResult, { code: 0, signal: null }, "The measured process must exit through its native window-close guard")
      process.stdout.write(`Native release performance run ${run + 1}/${launchCount} completed.\n`)
    } catch (error) {
      throw new Error(`Native release performance run ${run + 1} during ${operation}: ${error.message}; backend: ${backendOutput}`)
    } finally {
      if (!exitResult) {
        app.kill("SIGTERM")
        await Promise.race([exited, pause(1_000)])
        if (!exitResult) { app.kill("SIGKILL"); await exited }
      }
      await pause(1_000)
    }
  }
  report.p95Milliseconds = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, percentile95(values)]))
  const bootstrapStageSamples = new Map()
  for (const runStages of report.bootstrapStageRuns) {
    for (const stage of runStages) {
      const values = bootstrapStageSamples.get(stage.name) || []
      values.push(stage.milliseconds)
      bootstrapStageSamples.set(stage.name, values)
    }
  }
  for (const name of ["library-status", "initial-library-render", "editor-ready", "initial-paint", "native-ready-ack"]) {
    assert.equal(bootstrapStageSamples.get(name)?.length, launchCount, `Expected ${launchCount} native startup measurements for ${name}`)
  }
  report.p95BootstrapStageMilliseconds = Object.fromEntries([...bootstrapStageSamples]
    .filter(([, values]) => values.length >= launchCount)
    .map(([name, values]) => [name, percentile95(values)]))
  const openStageSamples = new Map()
  for (const trace of report.openTraceRuns) {
    const runStages = new Map()
    for (const stage of trace) {
      runStages.set(stage.name, (runStages.get(stage.name) || 0) + stage.milliseconds)
    }
    for (const [name, milliseconds] of runStages) {
      const values = openStageSamples.get(name) || []
      values.push(milliseconds)
      openStageSamples.set(name, values)
    }
  }
  for (const name of ["readDeck", "prepareDeck", "editorReady", "loadDocument", "deckViewSetup", "previewRefresh"]) {
    assert.equal(openStageSamples.get(name)?.length, launchCount, `Expected ${launchCount} native open measurements for ${name}`)
  }
  report.p95OpenStageMilliseconds = Object.fromEntries([...openStageSamples]
    .filter(([, values]) => values.length >= launchCount)
    .map(([name, values]) => [name, percentile95(values)]))
  const navigationStageSamples = new Map()
  for (const navigation of report.frontendNavigationRuns) {
    for (const [name, value] of Object.entries(navigation || {})) {
      const values = navigationStageSamples.get(name) || []
      values.push(value)
      navigationStageSamples.set(name, values)
    }
  }
  report.p95NavigationStageMilliseconds = Object.fromEntries([...navigationStageSamples]
    .filter(([, values]) => values.length >= launchCount)
    .map(([name, values]) => [name, percentile95(values)]))
  const previewStagePairs = [
    ["render", "render-start", "render-ready"],
    ["previewInstall", "preview-install-start", "preview-install-ready"],
    ["previewEvents", "preview-install-start", "preview-events-ready"],
    ["slideOverview", "slide-overview-render-start", "slide-overview-render-ready"],
    ["slideOverviewScale", "slide-overview-scale-start", "slide-overview-scale-ready"],
    ["slideOverflow", "slide-overflow-start", "slide-overflow-ready"]
  ]
  const previewStageSamples = new Map(previewStagePairs.map(([name]) => [name, []]))
  for (const trace of report.previewTraceRuns) {
    for (const [name, started, finished] of previewStagePairs) {
      const durations = []
      let start = null
      for (const event of trace) {
        if (event.stage === started) start = event.time
        else if (event.stage === finished && Number.isFinite(start)) {
          durations.push(event.time - start)
          start = null
        }
      }
      if (durations.length) previewStageSamples.get(name).push(Math.max(...durations))
    }
  }
  for (const name of ["render", "previewInstall", "previewEvents", "slideOverview", "slideOverviewScale", "slideOverflow"]) {
    assert.equal(previewStageSamples.get(name)?.length, launchCount, `Expected ${launchCount} native render measurements for ${name}`)
  }
  report.p95PreviewStageMilliseconds = Object.fromEntries([...previewStageSamples]
    .filter(([, values]) => values.length >= launchCount)
    .map(([name, values]) => [name, percentile95(values)]))
report.budgetsMilliseconds = { coldStart: 1500, open100Slides: 300, warmLibrary: 500 }
report.misses = Object.entries(report.budgetsMilliseconds).filter(([name, budget]) => report.p95Milliseconds[name] >= budget).map(([name]) => name)
report.budgetMode = reportOnly ? "runner-report-only" : "enforced"
process.stdout.write(JSON.stringify({ budgetMode: report.budgetMode, p95Milliseconds: report.p95Milliseconds, p95NavigationStageMilliseconds: report.p95NavigationStageMilliseconds, p95BootstrapStageMilliseconds: report.p95BootstrapStageMilliseconds, p95OpenStageMilliseconds: report.p95OpenStageMilliseconds, p95PreviewStageMilliseconds: report.p95PreviewStageMilliseconds, inputPreservedRuns: report.inputPreservedRuns, renderedLibraryCards: [...new Set(report.renderedLibraryCards)], misses: report.misses }) + "\n")
if (reportOnly) {
  if (report.misses.length) process.stderr.write(`Hosted runner measurements missed target-device budgets: ${report.misses.join(", ")}\n`)
} else {
  assert.deepEqual(report.misses, [], "Native release application performance exceeded its budgets")
}
} finally {
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + "\n")
  await rm(temporary, { recursive: true, force: true })
}
