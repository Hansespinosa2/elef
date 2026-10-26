import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { reportDiagnosticsExport } from "@elef/editor-runtime/test-internals"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
const shellSource = await readFile(
  path.join(root, "packages/editor-runtime/src/lib/file_library_application.ts"),
  "utf8"
)

function setup() {
  const calls = []
  const report = {
    exported: () => calls.push("exported"),
    failed: error => calls.push(["failed", error])
  }
  return { calls, report }
}

test("a completed diagnostics export reports success", async () => {
  const { calls, report } = setup()
  await reportDiagnosticsExport(async () => true, report)
  assert.deepEqual(calls, ["exported"])
})

test("a cancelled diagnostics export stays silent", async () => {
  const { calls, report } = setup()
  await reportDiagnosticsExport(async () => false, report)
  assert.deepEqual(calls, [])
})

test("a failed diagnostics export surfaces the native error unchanged", async () => {
  const { calls, report } = setup()
  const failure = {
    code: "io_error",
    message: "Diagnostics could not be exported.",
    retryable: true
  }
  await reportDiagnosticsExport(
    async () => {
      throw failure
    },
    report
  )
  assert.deepEqual(calls, [["failed", failure]])
})

test("the export-diagnostics menu action reports through the status/error seams", () => {
  assert.match(
    shellSource,
    /if \(action === "export-diagnostics"\) return exportDiagnosticsArchive\(\)/
  )
  assert.match(shellSource, /async function exportDiagnosticsArchive\(\): Promise<void>/)
  assert.match(shellSource, /setStatus\("Diagnostics exported"\)/)
  assert.match(shellSource, /failed: error => showError\(error\)/)
})
