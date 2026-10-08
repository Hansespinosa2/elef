import { browser } from "@wdio/globals"
import { readFile } from "node:fs/promises"
import { runSuite } from "../../../tests/host-conformance/suite.js"
import { createTauriHost, tauriPolicy } from "../../frontend/src/tauri-host.js"

// Contract conformance against the real desktop backend: every suite case
// drives Tauri invoke inside the app webview. Dialog-mediated delete stays
// declared (tauriPolicy) and is covered by the library-create-delete UI flow;
// export bytes come from the harness ELEF_E2E_EXPORT_PATH file.

async function invoke(command, args, options) {
  const result = await browser.execute(
    (cmd, payload, invokeOptions) => {
      let body = payload
      if (cmd === "upload_asset" && Array.isArray(payload)) body = new Uint8Array(payload)
      return window.__TAURI__.core
        .invoke(cmd, body, invokeOptions ?? undefined)
        .catch(error => ({ __elefInvokeError: error ?? { code: "internal" } }))
    },
    command,
    args,
    options ?? null,
  )
  return result
}

async function readExportFile() {
  const path = process.env.ELEF_E2E_EXPORT_PATH
  if (!path) throw new Error("ELEF_E2E_EXPORT_PATH is not set for the transfer case")
  return new Uint8Array(await readFile(path))
}

const shim = {
  equal: (actual, expected, message) => {
    if (actual !== expected) throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
  },
  ok: (value, message) => {
    if (!value) throw new Error(message ?? "expected truthy value")
  },
}

describe("host contract conformance (desktop invoke)", () => {
  it("passes the shared suite against the Tauri adapter", async () => {
    const host = createTauriHost({ invoke, readExportFile })
    const prefix = `wdio-tauri-${Date.now().toString(36)}`
    const results = await runSuite(host, tauriPolicy, prefix, shim)
    const failed = results.filter(result => result.outcome === "fail")
    const skipped = results.filter(result => result.outcome === "skip")
    if (failed.length > 0) {
      throw new Error(`conformance failures: ${failed.map(item => `${item.id}: ${item.reason}`).join("; ")}`)
    }
    if (skipped.length > 0) {
      console.log(`conformance skips: ${skipped.map(item => `${item.id} (${item.reason})`).join("; ")}`)
    }
  })
})
