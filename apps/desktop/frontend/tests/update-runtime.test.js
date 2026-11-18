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

test("the macOS update runtime prepares only after consent and activates without relaunch", async () => {
  const calls = []
  const runtime = createMacosUpdateRuntime({
    invoke: async (_command, args) => { calls.push(args.prepareOnly); return true },
    check: async () => ({ version: "0.2.0", close: async () => {} })
  })
  const update = await runtime.checkForUpdate()
  assert.deepEqual(calls, [], "checking must not prepare or install an update")
  assert.equal(await runtime.armPendingUpdate(update), true)
  assert.deepEqual(calls, [true])
  assert.equal(await runtime.installPendingUpdate(runtime.takeArmedUpdate(), {}), true)
  assert.deepEqual(calls, [true, false])
  assert.deepEqual(await runtime.updaterSeam.status(), { available: true, version: "0.2.0" })
})

test("a quit during download waits for preparation before activating", async () => {
  let finish
  const preparation = new Promise(resolve => { finish = resolve })
  const calls = []
  const runtime = createMacosUpdateRuntime({
    invoke: async (_command, args) => {
      calls.push(args.prepareOnly)
      return args.prepareOnly ? preparation : true
    }
  })
  const update = { version: "0.2.0", dispose: async () => {}, install: async () => {
    calls.push("activate")
    return true
  } }
  const preparing = runtime.armPendingUpdate(update)
  const armed = runtime.takeArmedUpdate()
  const installing = runtime.installPendingUpdate(armed, {})
  assert.deepEqual(calls, [true])
  finish(true)
  assert.equal(await preparing, true)
  assert.equal(await installing, true)
  assert.deepEqual(calls, [true, "activate"])
})

test("cancelled or failed preparation never activates an update", async () => {
  for (const failure of [false, new Error("bad signature")]) {
    let disposed = 0
    const runtime = createMacosUpdateRuntime({ invoke: async () => {
      if (failure instanceof Error) throw failure
      return false
    } })
    const update = { version: "0.2.0", dispose: async () => { disposed += 1 }, install: () => assert.fail("unprepared activation") }
    if (failure instanceof Error) await assert.rejects(runtime.armPendingUpdate(update), failure)
    else assert.equal(await runtime.armPendingUpdate(update), false)
    assert.equal(runtime.peekArmedUpdate(), null)
    assert.equal(disposed, 1)
  }
})

test("the macOS update runtime needs the Tauri invoke bridge", () => {
  assert.throws(() => createMacosUpdateRuntime({}), /invoke bridge/)
})
