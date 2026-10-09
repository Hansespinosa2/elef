import { readFile } from "node:fs/promises"
import path from "node:path"

import { parseLedger, recordPlatformFailure } from "../release/ledger.mjs"
import { publishPagesStateWithRetry } from "../release/pages-publisher.mjs"
import { verifyReleaseStateWriterPolicy } from "../release/release-state-ruleset-api.mjs"
import { writePagesStateFiles } from "../release/pages-state.mjs"

const [pagesRootArgument, version, platform, category] = process.argv.slice(2)
if (!pagesRootArgument || !version || !platform || !category) {
  throw new Error("usage: node record_desktop_platform_failure.mjs <gh-pages-checkout> <version> <platform> <failure-category>")
}
const failureMessages = {
  build_failed: "Platform build failed in CI.",
  signature_invalid: "Updater signature verification failed.",
  asset_verification_failed: "Immutable release asset verification failed.",
  asset_upload_failed: "GitHub release asset upload failed.",
  publication_failed: "Platform state publication failed after asset distribution.",
  aur_push_failed: "AUR package update failed after the GitHub asset was validated."
}
if (!["macos", "linux_asset", "aur"].includes(platform)) throw new TypeError("unknown release platform")
if (!Object.hasOwn(failureMessages, category)) throw new TypeError("unknown sanitized platform failure category")
const pagesRoot = path.resolve(pagesRootArgument)
const statePath = path.join(pagesRoot, "desktop/stable/state.json")
const at = new Date().toISOString()

await verifyReleaseStateWriterPolicy({
  repository: requiredEnv("GITHUB_REPOSITORY"),
  appId: requiredEnv("ELEF_RELEASE_STATE_APP_ID"),
  token: requiredEnv("ELEF_RELEASE_STATE_PUSH_TOKEN"),
  apiUrl: process.env.GITHUB_API_URL
})

const result = await publishPagesStateWithRetry({
  pagesRoot,
  reconcile: async () => {
    const ledger = parseLedger(await readFile(statePath, "utf8"))
    const release = ledger.releases.find(item => item.version === version)
    if (!release) throw new Error(`release ${version} has no central reservation`)
    if (release.blocked) return { version, platform, skipped: "blocked" }
    const current = release[platform]
    if (!current || !["pending", "failed"].includes(current.status)) return { version, platform, skipped: current?.status || "missing" }
    const next = recordPlatformFailure(ledger, version, platform, {
      reason: failureMessages[category],
      expectedRevision: ledger.revision,
      at
    })
    await writePagesStateFiles(pagesRoot, next)
    return { version, platform, failure: category, revision: next.revision }
  }
})
process.stdout.write(`Recorded ${result.reconciliation?.failure || category} for ${platform} ${version}; Pages ledger revision ${result.reconciliation?.revision || "unchanged"}.\n`)

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
