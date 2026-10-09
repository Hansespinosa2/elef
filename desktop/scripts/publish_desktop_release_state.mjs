import { appendFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { publishPagesStateWithRetry } from "../release/pages-publisher.mjs"

const [pagesRootArgument, sourceRootArgument] = process.argv.slice(2)
if (!pagesRootArgument || !sourceRootArgument) {
  throw new Error("usage: node desktop/scripts/publish_desktop_release_state.mjs <gh-pages-checkout> <main-checkout>")
}
const pagesRoot = path.resolve(pagesRootArgument)
const sourceRoot = path.resolve(sourceRootArgument)
const reconcileScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "reconcile_desktop_releases.mjs")

const result = await publishPagesStateWithRetry({
  pagesRoot,
  reconcile: () => runReconciliation(reconcileScript, pagesRoot, sourceRoot)
})
const reconciliation = result.reconciliation || {}
const processedMerges = result.processedMerges || []
const outputs = {
  initialized: reconciliation.initialized || false,
  revision: reconciliation.revision ?? "",
  last_reconciled_main: reconciliation.lastReconciledMain ?? "",
  pending_sha: reconciliation.pendingSha ?? "",
  pending_reason: reconciliation.pendingReason ?? "",
  processed_merges: processedMerges,
  macos_candidate: reconciliation.platformCandidates?.macos ? JSON.stringify(reconciliation.platformCandidates.macos) : "",
  linux_candidate: reconciliation.platformCandidates?.linux_asset ? JSON.stringify(reconciliation.platformCandidates.linux_asset) : "",
  aur_candidate: reconciliation.platformCandidates?.aur ? JSON.stringify(reconciliation.platformCandidates.aur) : "",
  failed_gate_count: result.failedGateCount || 0,
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

async function writeOutputs(values) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  await appendFile(output, [
    `initialized=${values.initialized}`,
    `revision=${values.revision}`,
    `last_reconciled_main=${values.last_reconciled_main}`,
    `pending_sha=${values.pending_sha}`,
    `pending_reason=${values.pending_reason}`,
    `processed_merges=${JSON.stringify(values.processed_merges)}`,
    `macos_candidate=${values.macos_candidate}`,
    `linux_candidate=${values.linux_candidate}`,
    `aur_candidate=${values.aur_candidate}`,
    `failed_gate_count=${values.failed_gate_count}`,
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
  if (detail.initialized) lines.push("- Release ledger initialized at the current main head; earlier merges are not retroactively released.")
  if (detail.pendingSha) lines.push(`- Waiting at main SHA \`${detail.pendingSha}\` (${detail.pendingReason}).`)
  if (detail.action && detail.action !== "reconcile") lines.push(`- Owner control action: \`${detail.action}\``)
  lines.push("", "The Pages projection records ledger state only. A reservation is not a public artifact or an installation result.")
  await appendFile(summary, `${lines.join("\n")}\n`)
}
