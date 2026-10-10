import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile, rm } from "node:fs/promises"

const sentinelFixture = JSON.parse(await readFile(
  new URL("../../test/fixtures/desktop/release/redaction-sentinels.json", import.meta.url),
  "utf8"
))
const sentinels = Object.values(sentinelFixture)

export async function exportAndVerifyDiagnostics(browser, expectedProfile, requiredFailureEvents = []) {
  const archivePath = process.env.ELEF_E2E_DIAGNOSTICS_EXPORT_PATH
  assert.ok(archivePath, "the disposable diagnostics archive path must be set")
  await rm(archivePath, { force: true })

  const exported = await browser.execute(async () => {
    if (!window.__TAURI__?.core?.invoke) return false
    return await window.__TAURI__.core.invoke("export_diagnostics_fixture")
  })
  assert.equal(exported, true, "the test-only command should export the diagnostics archive")
  await verifyDiagnosticsArchive(archivePath, expectedProfile, requiredFailureEvents)
}

export async function verifyDiagnosticsArchive(archivePath, expectedProfile, requiredFailureEvents = []) {
  const entries = execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean)
  const files = entries.filter(entry => !entry.endsWith("/"))
  assert.ok(entries.includes("README.txt"), "diagnostics ZIP should include its privacy/readme notice")
  assert.ok(entries.includes("logs/events.jsonl"), "diagnostics ZIP should include actionable event records")

  const entryContents = files.map(entry => execFileSync("unzip", ["-p", archivePath, entry], { encoding: "utf8" }))
  const archiveText = `${files.join("\n")}\n${entryContents.join("\n")}`
  for (const sentinel of sentinels) {
    assert.ok(!archiveText.includes(sentinel), `diagnostics ZIP leaked sentinel ${sentinel}`)
  }

  const logFiles = files.filter(entry => /^logs\/events(?:\.\d+)?\.jsonl$/.test(entry))
  const events = logFiles.flatMap(entry => execFileSync("unzip", ["-p", archivePath, entry], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).map(line => JSON.parse(line)))
  const eventKeys = [
    "architecture",
    "build_sha",
    "error_category",
    "event_code",
    "platform",
    "profile",
    "result",
    "timestamp_unix_ms",
    "version"
  ]
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), eventKeys)
    assert.match(event.version, /^\d+\.\d+\.\d+$/)
    assert.ok(event.timestamp_unix_ms > 0)
    assert.ok(event.build_sha === "unknown" || /^[a-f\d]{40}$/.test(event.build_sha))
    assert.ok(["linux", "macos"].includes(event.platform))
    assert.ok(["x86_64", "aarch64"].includes(event.architecture))
  }
  const redactedFailure = events.find(event =>
    event.event_code === "save" && event.result === "failure" && event.error_category === "unknown"
  )
  assert.ok(redactedFailure, "diagnostics ZIP should include a sanitized failure event")
  assert.equal(redactedFailure.profile, expectedProfile)
  for (const eventCode of requiredFailureEvents) {
    const expectedErrorCategory = eventCode === "import" ? "io" : "internal"
    assert.ok(events.some(event =>
      event.event_code === eventCode && event.result === "failure" && event.error_category === expectedErrorCategory
    ), `diagnostics ZIP should include a sanitized ${eventCode} failure event`)
  }
}
