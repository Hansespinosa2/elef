import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { desktopCommand } from "./offline-macos.js"
import { nativeQuit } from "./native-quit-smoke.js"
import { percentile95 } from "../frontend/src/performance-measurement.js"

const binary = process.argv[process.argv.indexOf("--binary") + 1]
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
  protocol: "20 fresh release processes; 1000 decks; one 50 MiB deck; painted operation timings",
  samples, inputPreservedRuns: 0 }

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
  for (let run = 0; run < 20; run += 1) {
    const folder = path.join(library, "0000 Large presentation")
    await writeFile(path.join(folder, "presentation.md"), source)
    const env = { ...process.env, ELEF_E2E_LIBRARY_ROOT: library, TAURI_WEBDRIVER_PORT: "4445" }
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
      const response = await fetch(`http://127.0.0.1:4445${route}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
      })
      const { value } = await response.json()
      if (!response.ok || value?.error) throw new Error(value?.message || `Driver HTTP ${response.status}`)
      return value
    }
    let session
    try {
      const deadline = Date.now() + 30_000
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
      const execute = (script, ...args) => request(`/session/${session.sessionId}/execute/sync`, { script, args })
      let interactiveAt
      while (!interactiveAt && Date.now() < deadline) {
        interactiveAt = await execute("return window.__elefPerformanceTestHooks?.interactiveAt || null")
        if (!interactiveAt) await pause(50)
      }
      assert.ok(interactiveAt, "The release frontend must acknowledge completed startup")
      samples.coldStart.push(interactiveAt - launchedAt)
      const listed = await execute("return await window.__elefPerformanceTestHooks.list()")
      assert.equal(listed.result, 1000)
      samples.warmLibrary.push(listed.milliseconds)
      const opened = await execute("return await window.__elefPerformanceTestHooks.open(arguments[0])", deckId)
      assert.equal(opened.result.id, deckId)
      assert.equal(opened.result.slides, 100)
      samples.open100Slides.push(opened.milliseconds)
      const typed = await execute("return await window.__elefPerformanceTestHooks.typeDuringSave(arguments[0])", "Input preserved 😀 日本語")
      assert.equal(typed, source + "\nInput preserved 😀 日本語")
      assert.equal(await readFile(path.join(folder, "presentation.md"), "utf8"), typed)
      report.inputPreservedRuns += 1
      nativeQuit(app.pid)
      const quitDeadline = Date.now() + 10_000
      while (!exitResult && Date.now() < quitDeadline) await pause(50)
      assert.deepEqual(exitResult, { code: 0, signal: null }, "The measured process must exit through its native Quit guard")
      process.stdout.write(`Native release performance run ${run + 1}/20 completed.\n`)
    } catch (error) {
      throw new Error(`Native release performance run ${run + 1}: ${error.message}; backend: ${backendOutput}`)
    } finally {
      if (!exitResult) {
        app.kill("SIGTERM")
        await Promise.race([exited, pause(1_000)])
        if (!exitResult) { app.kill("SIGKILL"); await exited }
      }
    }
  }
  report.p95Milliseconds = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, percentile95(values)]))
  report.budgetsMilliseconds = { coldStart: 1500, open100Slides: 300, warmLibrary: 500 }
  report.misses = Object.entries(report.budgetsMilliseconds).filter(([name, budget]) => report.p95Milliseconds[name] >= budget).map(([name]) => name)
  process.stdout.write(JSON.stringify({ p95Milliseconds: report.p95Milliseconds, inputPreservedRuns: report.inputPreservedRuns, misses: report.misses }) + "\n")
  assert.deepEqual(report.misses, [], "Native release application performance exceeded its budgets")
} finally {
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + "\n")
  await rm(temporary, { recursive: true, force: true })
}
