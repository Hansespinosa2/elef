import { appendFile, readFile } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { blockVersions, latestPendingPlatformRelease, parseLedger, selectMinorMilestone, unblockVersions } from "../release/ledger.mjs"
import { GitHubReleaseApi } from "../release/github-api.mjs"
import { assertAuthorizedReleaseTagDispatch } from "../release/coordinator-trust.mjs"
import { reconcileReleaseLedger } from "../release/reconciler.mjs"
import { writePagesStateFiles } from "../release/pages-state.mjs"

const [pagesRootArgument] = process.argv.slice(2)
if (!pagesRootArgument) throw new Error("usage: node desktop/scripts/reconcile_desktop_releases.mjs <gh-pages-checkout>")

const repository = requiredEnv("GITHUB_REPOSITORY")
const token = requiredEnv("GITHUB_TOKEN")
const actor = requiredEnv("GITHUB_ACTOR")
const eventName = process.env.GITHUB_EVENT_NAME || ""
const eventRef = process.env.GITHUB_REF || ""
const action = process.env.DESKTOP_RELEASE_ACTION || "reconcile"
const [owner, repositoryName] = repository.split("/")
if (!owner || !repositoryName) throw new Error("GITHUB_REPOSITORY must use owner/repository form")

const api = new GitHubReleaseApi({
  owner,
  repository: repositoryName,
  token,
  apiUrl: process.env.GITHUB_API_URL || "https://api.github.com"
})
const repoInfo = await api.repositoryInfo()
const pagesRoot = path.resolve(pagesRootArgument)
const statePath = path.join(pagesRoot, "desktop", "stable", "state.json")
const mainHistory = gitMainHistory()
if (mainHistory.length === 0) throw new Error("origin/main has no commits")
const previous = await readOptionalLedger(statePath)
let ledger = previous
let reconciliation = null
let initialized = false

if (eventName === "workflow_dispatch") assertAuthorizedReleaseTagDispatch({
  actor,
  repositoryOwner: repoInfo.owner.login,
  ref: eventRef,
  refType: requiredEnv("GITHUB_REF_TYPE"),
  refName: requiredEnv("GITHUB_REF_NAME"),
  sha: requiredEnv("GITHUB_SHA"),
  workflowSha: requiredEnv("DESKTOP_WORKFLOW_SHA"),
  ledger
})

if (action === "reconcile") {
  reconciliation = await reconcileReleaseLedger({
    ledger,
    mainHistory,
    github: api,
    ownerLogin: repoInfo.owner.login
  })
  ledger = reconciliation.ledger
  initialized = reconciliation.initialized
} else {
  if (eventName !== "workflow_dispatch") throw new Error("release controls are available only through workflow_dispatch")
  if (actor.toLowerCase() !== repoInfo.owner.login.toLowerCase()) {
    throw new Error("release control requires the repository owner")
  }
  if (!ledger) throw new Error("initialize release state through an ordinary main reconciliation before using controls")
  const expectedRevision = ledger.revision
  const at = new Date().toISOString()
  const reason = process.env.DESKTOP_RELEASE_REASON || ""
  if (action === "minor") {
    ledger = selectMinorMilestone(ledger, process.env.DESKTOP_RELEASE_MINOR || "", {
      actor,
      reason,
      expectedRevision,
      at
    })
  } else if (action === "block" || action === "unblock") {
    const versions = parseVersions(process.env.DESKTOP_RELEASE_VERSIONS || "")
    ledger = action === "block"
      ? blockVersions(ledger, versions, { actor, reason, expectedRevision, at })
      : unblockVersions(ledger, versions, { actor, reason, expectedRevision, at })
  } else {
    throw new Error("unknown release control action")
  }
}

await writePagesStateFiles(pagesRoot, ledger)
const result = {
  initialized,
  revision: ledger.revision,
  lastReconciledMain: ledger.last_reconciled_main,
  pendingSha: reconciliation?.pendingSha || "",
  pendingReason: reconciliation?.pendingReason || "",
  unapprovedMerges: reconciliation?.unapprovedMerges || [],
  recoveredMerges: reconciliation?.recoveredMerges || [],
  processedMerges: reconciliation?.processedMerges || [],
  platformCandidates: Object.fromEntries(["macos", "linux_asset", "aur"].map(platform => {
    const release = latestPendingPlatformRelease(ledger, platform)
    return [platform, release ? { version: release.version, tag: release.tag, main_sha: release.main_sha, pr: release.pr } : null]
  })),
  publicVersions: ledger.releases.filter(release => release.public && !release.blocked).map(release => release.version),
  action
}
if (process.env.DESKTOP_RELEASE_MACHINE_OUTPUT === "1") {
  process.stdout.write(`${JSON.stringify(result)}\n`)
} else {
  await writeOutputs(result)
  await writeSummary({ ledger, reconciliation, initialized, action })
  process.stdout.write(`Release state revision ${ledger.revision}; main watermark ${ledger.last_reconciled_main}.\n`)
}

async function readOptionalLedger(filename) {
  try {
    return parseLedger(await readFile(filename, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function gitMainHistory() {
  const mainRepository = process.env.DESKTOP_MAIN_REPOSITORY_PATH || process.cwd()
  const output = execFileSync("git", ["-C", mainRepository, "rev-list", "--first-parent", "--reverse", "origin/main"], { encoding: "utf8" }).trim()
  return output ? output.split(/\r?\n/) : []
}

async function writeOutputs(values) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  await appendFile(output, [
    `initialized=${values.initialized}`,
    `revision=${values.revision}`,
    `last_reconciled_main=${values.lastReconciledMain}`,
    `pending_sha=${values.pendingSha}`,
    `pending_reason=${values.pendingReason}`,
    `unapproved_merges=${JSON.stringify(values.unapprovedMerges)}`,
    `recovered_merges=${JSON.stringify(values.recoveredMerges)}`,
    `processed_merges=${JSON.stringify(values.processedMerges)}`,
    `macos_candidate=${values.platformCandidates.macos ? JSON.stringify(values.platformCandidates.macos) : ""}`,
    `linux_candidate=${values.platformCandidates.linux_asset ? JSON.stringify(values.platformCandidates.linux_asset) : ""}`,
    `aur_candidate=${values.platformCandidates.aur ? JSON.stringify(values.platformCandidates.aur) : ""}`,
    `failed_gate_count=${values.processedMerges.filter(merge => merge.gate === "failed_gate").length}`,
    `public_versions=${JSON.stringify(values.publicVersions)}`
  ].join("\n") + "\n")
}

async function writeSummary({ ledger, reconciliation, initialized: didInitialize, action: requestedAction }) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  const lines = [
    "## Desktop release reconciliation",
    "",
    `- Action: \`${requestedAction}\``,
    `- Ledger revision: \`${ledger.revision}\``,
    `- Reconciled main SHA: \`${ledger.last_reconciled_main}\``,
    `- New reservations: ${reconciliation?.processedMerges.filter(merge => merge.version).length || 0}`,
    `- Failed Gate A merges: ${reconciliation?.processedMerges.filter(merge => merge.gate === "failed_gate").length || 0}`
  ]
  if (didInitialize) lines.push("- Release ledger initialized at the current main head; earlier merges are not retroactively released.")
  if (reconciliation?.pendingSha) lines.push(`- Waiting at main SHA \`${reconciliation.pendingSha}\` (${reconciliation.pendingReason}).`)
  if (reconciliation?.unapprovedMerges.length) {
    lines.push(`- Merged PRs without a current repository-owner approval were held from release: ${reconciliation.unapprovedMerges.map(item => `#${item.pr}`).join(", ")}`)
  }
  for (const event of reconciliation?.recoveredMerges || []) {
    lines.push(`- Recovery checkpoint: owner-approved PR #${event.recovery_pr} restored the verified tree from \`${event.base_sha}\`; held PRs ${event.held_merges.map(item => `#${item.pr}`).join(", ")} were not released.`)
  }
  lines.push("", "This job reconciles source history and ledger state. It does not prove a public platform artifact, Pages availability, or a user-device installation.")
  await appendFile(summaryPath, `${lines.join("\n")}\n`)
}

function parseVersions(input) {
  const versions = input.split(/[\s,]+/).map(version => version.trim()).filter(Boolean)
  if (!versions.length) throw new Error("block or unblock action requires at least one version")
  return versions
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
