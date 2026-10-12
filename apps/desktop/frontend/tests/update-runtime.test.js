import assert from "node:assert/strict"
import test from "node:test"
import { Channel } from "@tauri-apps/api/core"
import { createDesktopUpdateRuntime as createDisabledUpdateRuntime } from "../src/update-runtime-disabled.js"
import { createDesktopUpdateRuntime as createMacosUpdateRuntime } from "../src/update-runtime-macos.js"

// The progress channel registers with the Tauri webview bridge at
// construction; the stub keeps the real Channel class under test.
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")
globalThis.window = { __TAURI_INTERNALS__: { transformCallback: () => 1 } }
test.after(() => {
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor)
  else delete globalThis.window
})

test("the disabled update runtime reports the package-managed boundary", async () => {
  const runtime = createDisabledUpdateRuntime()
  assert.equal(runtime.enabled, false)
  assert.equal(await runtime.checkForUpdate(), null)
  assert.equal(await runtime.installPendingUpdate({ version: "0.2.0" }), false)
  assert.equal(runtime.updaterSeam, null)
  runtime.armPendingUpdate({ version: "0.2.0" })
  assert.equal(runtime.peekArmedUpdate(), null)
  assert.equal(runtime.takeArmedUpdate(), null)
  runtime.clearArmedUpdate()
})

test("the macOS update runtime checks through the plugin and installs the native confirmed command", async () => {
  const calls = []
  const runtime = createMacosUpdateRuntime({
    invoke: async (command, args) => {
      calls.push([command, args.version, args.onProgress])
      return true
    },
    check: async options => {
      calls.push(["check", options.timeout])
      return { version: "0.2.0", body: "Fixes", close: async () => {} }
    }
  })
  assert.equal(runtime.enabled, true)
  const update = await runtime.checkForUpdate()
  assert.equal(update.version, "0.2.0")
  assert.equal(update.notes, "Fixes")
  assert.deepEqual(calls, [["check", 10_000]])
  await update.install(() => {})
  assert.deepEqual(calls[1].slice(0, 2), ["install_update", "0.2.0"])
  assert.ok(calls[1][2] instanceof Channel)
  await update.dispose()
})

test("the macOS update runtime installs pending updates with relaunch and reports seam availability", async () => {
  let relaunched = false
  const runtime = createMacosUpdateRuntime({
    invoke: async () => true,
    check: async () => ({ version: "0.2.0", close: async () => {} }),
    relaunch: async () => { relaunched = true }
  })
  const update = await runtime.checkForUpdate()
  assert.equal(await runtime.installPendingUpdate(update, {}), true)
  assert.equal(relaunched, true)
  assert.deepEqual(await runtime.updaterSeam.status(), { available: true, version: "0.2.0" })
})

test("the macOS update runtime owns the safe-quit arming state", async () => {
  const runtime = createMacosUpdateRuntime({ invoke: async () => true, check: async () => null })
  const disposed = []
  const first = { version: "0.2.0", dispose: async () => { disposed.push("first") } }
  const second = { version: "0.2.1", dispose: async () => { disposed.push("second") } }
  assert.equal(runtime.peekArmedUpdate(), null)
  runtime.armPendingUpdate(first)
  assert.equal(runtime.peekArmedUpdate(), first)
  runtime.armPendingUpdate(second)
  assert.equal(runtime.peekArmedUpdate(), second)
  assert.deepEqual(disposed, ["first"])
  assert.equal(runtime.takeArmedUpdate(), second)
  assert.equal(runtime.peekArmedUpdate(), null)
  assert.deepEqual(disposed, ["first"])
  runtime.armPendingUpdate(first)
  runtime.clearArmedUpdate()
  assert.equal(runtime.peekArmedUpdate(), null)
  assert.deepEqual(disposed, ["first", "first"])
})

test("the macOS update runtime needs the Tauri invoke bridge", () => {
  assert.throws(() => createMacosUpdateRuntime({}), /invoke bridge/)
})
