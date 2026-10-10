import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import test from "node:test"
import os from "node:os"
import path from "node:path"
import { verifyDiagnosticsArchive } from "./diagnostics-archive.js"

const sentinels = Object.values(JSON.parse(await readFile(
  new URL("../../test/fixtures/desktop/release/redaction-sentinels.json", import.meta.url),
  "utf8"
)))

test("diagnostics archive verifier accepts actionable records and rejects every privacy sentinel", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "elef-diagnostics-archive-test-"))
  try {
    const logDirectory = path.join(directory, "logs")
    await mkdir(logDirectory)
    await writeFile(path.join(directory, "README.txt"), "Allowlisted local diagnostics.\n")
    const diagnosticEvent = (event_code, error_category) => ({
      timestamp_unix_ms: 1760000000000,
      version: "0.2.0",
      build_sha: "a".repeat(40),
      profile: "stable",
      platform: process.platform === "darwin" ? "macos" : "linux",
      architecture: process.arch === "arm64" ? "aarch64" : "x86_64",
      event_code,
      result: "failure",
      error_category
    })
    await writeFile(path.join(logDirectory, "events.jsonl"), [
      diagnosticEvent("save", "unknown"),
      diagnosticEvent("import", "io")
    ].map(JSON.stringify).join("\n") + "\n")
    const archive = path.join(directory, "diagnostics.zip")
    execFileSync("zip", ["-q", "-r", archive, "README.txt", "logs"], { cwd: directory })
    await verifyDiagnosticsArchive(archive, "stable", ["import"])

    const hostileArchive = path.join(directory, "hostile-diagnostics.zip")
    for (const sentinel of sentinels) {
      await writeFile(path.join(directory, "hostile.txt"), sentinel)
      await rm(hostileArchive, { force: true })
      execFileSync("zip", ["-q", "-r", hostileArchive, "README.txt", "logs", "hostile.txt"], { cwd: directory })
      await assert.rejects(verifyDiagnosticsArchive(hostileArchive, "stable"), error =>
        error.message.includes(sentinel))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
