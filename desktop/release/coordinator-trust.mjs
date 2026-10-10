import { reconcileReleaseLedger } from "./reconciler.mjs"

/**
 * A release workflow may use only the exact main revision that passed Gate A
 * and the repository-owner authorization check. Later main commits are data
 * for reconciliation, never implicit release tooling.
 */
export async function assertTrustedCoordinatorRevision({ coordinatorSha, mainHistory, ledger, github, ownerLogin }) {
  if (typeof coordinatorSha !== "string" || !/^[a-f0-9]{40}$/i.test(coordinatorSha)) {
    throw new TypeError("coordinator revision must be a commit SHA")
  }
  if (!Array.isArray(mainHistory) || mainHistory.length === 0) {
    throw new TypeError("coordinator verification needs the current first-parent main history")
  }
  if (!ledger || typeof ledger !== "object") throw new Error("release tooling needs an initialized Pages ledger")
  if (!github || !ownerLogin) throw new TypeError("coordinator verification needs GitHub records and the repository owner")

  const coordinatorIndex = mainHistory.indexOf(coordinatorSha)
  if (coordinatorIndex < 0) throw new Error("coordinator revision is not in the current first-parent main history")

  const associations = await github.pullRequestsForCommit(coordinatorSha)
  const matching = associations.filter(pr => pr.base?.ref === "main" && pr.merge_commit_sha === coordinatorSha)
  if (matching.length !== 1) throw new Error("coordinator revision must map to exactly one merged main pull request")
  const associated = matching[0]
  const pullRequest = await github.pullRequest(associated.number)
  if (!pullRequest || pullRequest.base?.ref !== "main" || !pullRequest.merged_at || pullRequest.merge_commit_sha !== coordinatorSha) {
    throw new Error("coordinator pull request metadata is incomplete")
  }
  if (!await github.ownerApprovedPullRequest(pullRequest, ownerLogin)) {
    throw new Error("coordinator pull request does not have the required repository-owner approval")
  }
  if (await github.gateForMainSha(coordinatorSha) !== "passed") {
    throw new Error("coordinator revision has not passed the exact-SHA main release gate")
  }

  const watermarkIndex = mainHistory.indexOf(ledger.last_reconciled_main)
  if (watermarkIndex < 0) throw new Error("Pages ledger watermark is not in the current first-parent main history")
  if (watermarkIndex > coordinatorIndex) {
    const recorded = ledger.processed_merges?.find(merge => merge.sha === coordinatorSha)
    if (recorded?.gate !== "passed") {
      throw new Error("Pages ledger has advanced past an unverified coordinator revision")
    }
    return { sha: coordinatorSha, pr: pullRequest.number }
  }

  if (watermarkIndex === coordinatorIndex) {
    const recorded = ledger.processed_merges?.find(merge => merge.sha === coordinatorSha)
    if (recorded?.gate !== "passed") {
      throw new Error("Pages ledger watermark cannot establish coordinator trust without a passed merge record")
    }
    return { sha: coordinatorSha, pr: pullRequest.number }
  }

  const verification = await reconcileReleaseLedger({
    ledger,
    mainHistory: mainHistory.slice(0, coordinatorIndex + 1),
    github,
    ownerLogin
  })
  const accepted = verification.ledger.processed_merges.find(merge => merge.sha === coordinatorSha)
  if (verification.pendingSha || verification.ledger.last_reconciled_main !== coordinatorSha || accepted?.gate !== "passed") {
    throw new Error("coordinator revision is behind an unresolved or unauthorized main merge")
  }

  return { sha: coordinatorSha, pr: pullRequest.number }
}

export async function selectTrustedCoordinatorRevision({ coordinatorSha, mainHistory, ledger, github, ownerLogin }) {
  let currentError
  try {
    return { ...(await assertTrustedCoordinatorRevision({ coordinatorSha, mainHistory, ledger, github, ownerLogin })), selectedFrom: "event" }
  } catch (error) {
    currentError = error
  }

  const fallbackSha = latestTrustedToolingSha(ledger)
  if (!fallbackSha || fallbackSha === coordinatorSha) throw currentError
  const fallback = await assertTrustedCoordinatorRevision({
    coordinatorSha: fallbackSha,
    mainHistory,
    ledger,
    github,
    ownerLogin
  })
  return { ...fallback, selectedFrom: "ledger", rejectedEventReason: currentError.message }
}

export function latestTrustedToolingSha(ledger) {
  if (!ledger || !Array.isArray(ledger.processed_merges)) {
    throw new TypeError("trusted tooling selection needs a release ledger")
  }
  const eligible = ledger.processed_merges.filter(merge =>
    merge?.gate === "passed" &&
    typeof merge.sha === "string" &&
    /^[a-f0-9]{40}$/i.test(merge.sha) &&
    Number.isInteger(merge.main_order) &&
    merge.main_order >= 0
  )
  eligible.sort((left, right) => right.main_order - left.main_order)
  return eligible[0]?.sha || null
}
