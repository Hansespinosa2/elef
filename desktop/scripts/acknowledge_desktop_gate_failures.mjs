import { readFile } from "node:fs/promises"
import path from "node:path"

import { acknowledgeFailedGateNotifications, parseLedger } from "../release/ledger.mjs"
import { publishPagesStateWithRetry } from "../release/pages-publisher.mjs"
import { writePagesStateFiles } from "../release/pages-state.mjs"
import { verifyReleaseStateWriterPolicy } from "../release/release-state-ruleset-api.mjs"

const pagesRootArgument = process.argv[2]
if (!pagesRootArgument) throw new Error("usage: node desktop/scripts/acknowledge_desktop_gate_failures.mjs <gh-pages-checkout>")

const pagesRoot = path.resolve(pagesRootArgument)
const shas = parseShas(requiredEnv("DESKTOP_FAILED_GATE_NOTIFICATION_SHAS"))
await verifyReleaseStateWriterPolicy({
  repository: requiredEnv("GITHUB_REPOSITORY"),
  appId: requiredEnv("ELEF_RELEASE_STATE_APP_ID"),
  token: requiredEnv("ELEF_RELEASE_STATE_PUSH_TOKEN"),
  apiUrl: process.env.GITHUB_API_URL
})

const result = await publishPagesStateWithRetry({
  pagesRoot,
  reconcile: async () => {
    const ledger = parseLedger(await readFile(path.join(pagesRoot, "desktop/stable/state.json"), "utf8"))
    const acknowledged = acknowledgeFailedGateNotifications(ledger, shas, {
      expectedRevision: ledger.revision,
      at: new Date().toISOString()
    })
    await writePagesStateFiles(pagesRoot, acknowledged)
    return { acknowledgedShas: shas }
  }
})

const finalLedger = parseLedger(await readFile(path.join(pagesRoot, "desktop/stable/state.json"), "utf8"))
for (const sha of shas) {
  const merge = finalLedger.processed_merges.find(item => item.sha === sha)
  if (merge?.gate !== "failed_gate" || merge.failure_notification_acknowledged !== true) {
    throw new Error("failed-gate notification acknowledgment was not preserved in the Pages ledger")
  }
}
process.stdout.write(`Recorded acknowledgment for ${shas.length} emitted failed Gate A alert(s) in ledger revision ${finalLedger.revision}; Pages commit ${result.commitSha || "unchanged"}.\n`)

function parseShas(value) {
  let shas
  try {
    shas = JSON.parse(value)
  } catch {
    throw new Error("failed-gate notification SHA list must be valid JSON")
  }
  if (!Array.isArray(shas) || !shas.length || shas.some(sha => typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha))) {
    throw new Error("failed-gate notification SHA list must contain one or more commit SHAs")
  }
  return [...new Set(shas)]
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
