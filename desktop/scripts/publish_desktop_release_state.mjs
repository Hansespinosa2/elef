import { appendFile, readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { publishPagesStateWithRetry } from "../release/pages-publisher.mjs"
import { isRecordedFailedGate, parseLedger, pendingFailedGateNotifications } from "../release/ledger.mjs"
import { verifyReleaseStateWriterPolicy } from "../release/release-state-ruleset-api.mjs"

const [pagesRootArgument, sourceRootArgument] = process.argv.slice(2)
if (!pagesRootArgument || !sourceRootArgument) {
  throw new Error("usage: node desktop/scripts/publish_desktop_release_state.mjs <gh-pages-checkout> <main-checkout>")
}
const pagesRoot = path.resolve(pagesRootArgument)
const sourceRoot = path.resolve(sourceRootArgument)
const reconcileScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "reconcile_desktop_releases.mjs")

await verifyReleaseStateWriterPolicy({
  repository: requiredEnv("GITHUB_REPOSITORY"),
  appId: requiredEnv("ELEF_RELEASE_STATE_APP_ID"),
  token: requiredEnv("ELEF_RELEASE_STATE_PUSH_TOKEN"),
  apiUrl: process.env.GITHUB_API_URL
})
const result = await publishPagesStateWithRetry({
  pagesRoot,
  reconcile: () => runReconciliation(reconcileScript, pagesRoot, sourceRoot)
})
const reconciliation = result.reconciliation || {}
const processedMerges = result.processedMerges || []
const failureOnly = process.env.DESKTOP_RELEASE_FAILURE_ONLY === "true"
const failureSha = process.env.DESKTOP_RELEASE_FAILURE_SHA || ""
if (failureOnly && !/^[a-f0-9]{40}$/i.test(failureSha)) throw new Error("failure-only reconciliation needs its exact failed main SHA")
const committedLedger = parseLedger(await readFile(path.join(pagesRoot, "desktop/stable/state.json"), "utf8"))
const failureShaRecorded = Boolean(failureSha && isRecordedFailedGate(committedLedger, failureSha))
const failedNotificationShas = pendingFailedGateNotifications(committedLedger)
const outputs = {
  initialized: reconciliation.initialized || false,
  revision: reconciliation.revision ?? "",
  last_reconciled_main: reconciliation.lastReconciledMain ?? "",
  pending_sha: reconciliation.pendingSha ?? "",
  pending_reason: reconciliation.pendingReason ?? "",
  unapproved_merges: reconciliation.unapprovedMerges ?? [],
  recovered_merges: reconciliation.recoveredMerges ?? [],
  processed_merges: processedMerges,
  macos_candidate: !failureOnly && reconciliation.platformCandidates?.macos ? JSON.stringify(reconciliation.platformCandidates.macos) : "",
  linux_candidate: !failureOnly && reconciliation.platformCandidates?.linux_asset ? JSON.stringify(reconciliation.platformCandidates.linux_asset) : "",
  aur_candidate: !failureOnly && reconciliation.platformCandidates?.aur ? JSON.stringify(reconciliation.platformCandidates.aur) : "",
  failed_gate_count: result.failedGateCount || 0,
  failure_only: failureOnly,
  failure_sha: failureSha,
  failure_sha_recorded: failureShaRecorded,
  failed_notification_shas: failedNotificationShas,
  public_versions: reconciliation.publicVersions || [],
  cas_attempts: result.attempts,
  pages_commit: result.commitSha || ""
}
await writeOutputs(outputs)
await writeSummary({ outputs, published: result.published, reconciliation })
process.stdout.write(`Pages ledger revision ${outputs.revision}; CAS attempts ${outputs.cas_attempts}; Pages commit ${outputs.pages_commit || "unchanged"}.\n`)

function runReconciliation(script, pages, source) {
  const fetchedMain = runGit(source, ["fetch", "origin", "main:refs/remotes/origin/main"])
  if (fetchedMain.status !== 0) throw new Error("could not refresh origin/main before release reconciliation")
  const child = spawnSync(process.execPath, [script, pages], {
    cwd: source,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      DESKTOP_MAIN_REPOSITORY_PATH: source,
      DESKTOP_RELEASE_MACHINE_OUTPUT: "1"
    }
  })
  if (child.error) throw new Error("could not start release reconciliation")
  if (child.status !== 0) {
    if (child.stderr) process.stderr.write(child.stderr)
    throw new Error(`release reconciliation failed with exit code ${child.status ?? "unknown"}`)
  }
  try {
    return JSON.parse(child.stdout.trim())
  } catch {
    throw new Error("release reconciliation returned invalid machine output")
  }
}

function runGit(repositoryPath, args) {
  const result = spawnSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 })
  if (result.error) throw new Error("could not run Git for desktop release reconciliation")
  return { status: result.status ?? 1, stdout: result.stdout || "" }
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}

async function writeOutputs(values) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  await appendFile(output, [
    `initialized=${values.initialized}`,
    `revision=${values.revision}`,
    `last_reconciled_main=${values.last_reconciled_main}`,
    `pending_sha=${values.pending_sha}`,
    `pending_reason=${values.pending_reason}`,
    `unapproved_merges=${JSON.stringify(values.unapproved_merges)}`,
    `recovered_merges=${JSON.stringify(values.recovered_merges)}`,
    `processed_merges=${JSON.stringify(values.processed_merges)}`,
    `macos_candidate=${values.macos_candidate}`,
    `linux_candidate=${values.linux_candidate}`,
    `aur_candidate=${values.aur_candidate}`,
    `failed_gate_count=${values.failed_gate_count}`,
    `failure_only=${values.failure_only}`,
    `failure_sha=${values.failure_sha}`,
    `failure_sha_recorded=${values.failure_sha_recorded}`,
    `failed_notification_shas=${JSON.stringify(values.failed_notification_shas)}`,
    `public_versions=${JSON.stringify(values.public_versions)}`,
    `cas_attempts=${values.cas_attempts}`,
    `pages_commit=${values.pages_commit}`
  ].join("\n") + "\n")
}

async function writeSummary({ outputs: values, published, reconciliation: detail }) {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  const lines = [
    "## Desktop release state reconciliation",
    "",
    `- Ledger revision: \`${values.revision}\``,
    `- Reconciled main SHA: \`${values.last_reconciled_main}\``,
    `- Pages branch commit: ${published ? `\`${values.pages_commit}\`` : "unchanged"}`,
    `- Compare-and-swap attempts: ${values.cas_attempts}`,
    `- New version reservations: ${values.processed_merges.filter(merge => merge.version).length}`,
    `- Failed Gate A merges: ${values.failed_gate_count}`
  ]
  if (values.failure_only) lines.push("- Bootstrap mode: failure-only; platform candidate outputs were suppressed.")
  if (values.failure_only && values.failure_sha_recorded) lines.push(`- Exact failed SHA ${values.failure_sha} is durably recorded as failed_gate.`)
  if (values.failure_only && !values.failure_sha_recorded) {
    const blocker = values.pending_sha ? ` Reconciliation is waiting at ${values.pending_sha} (${values.pending_reason}).` : " No matching failed-gate ledger record exists yet."
    lines.push(`- Exact failed SHA ${values.failure_sha} is not yet recorded; owner notification will report this pending state.${blocker}`)
  }
  if (values.failed_notification_shas.length) lines.push(`- Failed-gate owner alerts awaiting acknowledgment: ${values.failed_notification_shas.join(", ")}.`)
  if (detail.initialized) lines.push("- Release ledger initialized at the current main head; earlier merges are not retroactively released.")
  if (detail.pendingSha) lines.push(`- Waiting at main SHA \`${detail.pendingSha}\` (${detail.pendingReason}).`)
  if (detail.unapprovedMerges?.length) {
    lines.push(`- Merged PRs without owner approval were held from release: ${detail.unapprovedMerges.map(merge => `#${merge.pr}`).join(", ")}.`)
  }
  for (const event of detail.recoveredMerges || []) {
    lines.push(`- Recovery checkpoint: owner-approved PR #${event.recovery_pr} restored the verified tree from \`${event.base_sha}\`; held PRs ${event.held_merges.map(merge => `#${merge.pr}`).join(", ")} were not released.`)
  }
  if (detail.action && detail.action !== "reconcile") lines.push(`- Owner control action: \`${detail.action}\``)
  lines.push("", "The Pages projection records ledger state only. A reservation is not a public artifact or an installation result.")
  await appendFile(summary, `${lines.join("\n")}\n`)
}
