import { createLedger, reconcileMain, validateLedger } from "./ledger.mjs"

/**
 * Reconcile ledger state against a complete oldest-to-newest first-parent
 * main history snapshot and authoritative GitHub PR/check records.
 */
export async function reconcileReleaseLedger({ ledger, mainHistory, github, ownerLogin, now }) {
  if (!Array.isArray(mainHistory) || mainHistory.length === 0) throw new TypeError("main history must include its current head")
  if (!github || !ownerLogin) throw new TypeError("reconciliation needs GitHub records and the repository owner")
  const head = mainHistory.at(-1)

  if (!ledger) {
    const initialized = createLedger({ currentMinor: "0.1", lastReconciledMain: head })
    return { ledger: initialized, initialized: true, pendingSha: null, unapprovedMerges: [], processedMerges: [] }
  }
  validateLedger(ledger)
  if (ledger.last_reconciled_main === null) {
    if (ledger.processed_merges.length || ledger.releases.length) {
      throw new Error("release ledger has records but no main history baseline")
    }
    const initialized = createLedger({ currentMinor: ledger.current_minor, lastReconciledMain: head })
    return { ledger: initialized, initialized: true, pendingSha: null, unapprovedMerges: [], processedMerges: [] }
  }

  const baselineIndex = mainHistory.indexOf(ledger.last_reconciled_main)
  if (baselineIndex < 0) throw new Error("last reconciled main SHA is not in current first-parent history")

  const newMerges = []
  const unapprovedMerges = []
  let pendingSha = null
  let pendingReason = null
  let historyEnd = mainHistory.length - 1

  for (let index = baselineIndex + 1; index < mainHistory.length; index += 1) {
    const sha = mainHistory[index]
    const associations = await github.pullRequestsForCommit(sha)
    const matching = associations.filter(pr => pr.base?.ref === "main" && pr.merge_commit_sha === sha)
    if (matching.length > 1) throw new Error(`main commit ${sha} is associated with multiple merged pull requests`)
    const associated = matching[0]
    if (!associated) {
      pendingSha = sha
      pendingReason = "pr_association_unavailable"
      historyEnd = index - 1
      break
    }

    const pullRequest = await github.pullRequest(associated.number)
    if (!pullRequest || pullRequest.base?.ref !== "main" || !pullRequest.merged_at || pullRequest.merge_commit_sha !== sha) {
      pendingSha = sha
      pendingReason = "pr_record_unavailable"
      historyEnd = index - 1
      break
    }
    if (!await github.ownerApprovedPullRequest(pullRequest, ownerLogin)) {
      unapprovedMerges.push({ pr: pullRequest.number, sha })
      pendingSha = sha
      pendingReason = "unapproved_pr"
      historyEnd = index - 1
      break
    }

    const gate = await github.gateForMainSha(sha)
    if (gate === null) {
      pendingSha = sha
      pendingReason = "gate_pending"
      historyEnd = index - 1
      break
    }
    if (gate !== "passed" && gate !== "failed_gate") {
      throw new Error(`main SHA ${sha} has an invalid terminal Gate A state`)
    }
    newMerges.push({
      base: "main",
      merged: true,
      approved: true,
      pr: pullRequest.number,
      sha,
      gate
    })
  }

  const existingTags = await github.versionTags()
  const before = new Set(ledger.processed_merges.map(merge => merge.sha))
  const next = reconcileMain(ledger, {
    mainHistory: mainHistory.slice(0, historyEnd + 1),
    merges: newMerges,
    existingTags,
    expectedRevision: ledger.revision,
    now
  })
  const processedMerges = next.processed_merges.filter(merge => !before.has(merge.sha))
  return { ledger: next, initialized: false, pendingSha, pendingReason, unapprovedMerges, processedMerges }
}
