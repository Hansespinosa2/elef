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
  if (typeof github.verifyMainReviewProtection !== "function") {
    throw new TypeError("coordinator verification needs an authoritative main review-protection check")
  }
  await github.verifyMainReviewProtection()

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

export function assertMainReviewProtection(rules) {
  if (!Array.isArray(rules)) throw new TypeError("main review-protection verification needs effective branch rules")
  const reviewRule = rules.find(rule =>
    rule?.type === "pull_request" &&
    Number.isInteger(rule.parameters?.required_approving_review_count) &&
    rule.parameters.required_approving_review_count >= 1 &&
    rule.parameters.require_code_owner_review === true
  )
  if (!reviewRule) {
    throw new Error("effective main branch rules must require an approving review and CODEOWNERS review")
  }
  return true
}

export function isExactFailedMainWorkflowRun({ mode, eventName, triggerEvent, triggerBranch, triggerSha, gateConclusion, ref, refType, refName, workflowSha, coordinatorSha }) {
  return mode === "current" &&
    eventName === "workflow_run" &&
    triggerEvent === "push" &&
    triggerBranch === "main" &&
    triggerSha === coordinatorSha &&
    Boolean(gateConclusion) &&
    gateConclusion !== "success" &&
    ref === "refs/heads/main" &&
    refType === "branch" &&
    refName === "main" &&
    workflowSha === coordinatorSha
}

/** Owner-triggered replay may record only a failed exact current-main Gate A. */
export function isExactFailedMainReconcileDispatch({ mode, eventName, action, actor, ownerLogin, ref, refType, refName, workflowSha, coordinatorSha }) {
  return mode === "current" &&
    eventName === "workflow_dispatch" &&
    action === "reconcile" &&
    typeof actor === "string" &&
    typeof ownerLogin === "string" &&
    actor.toLowerCase() === ownerLogin.toLowerCase() &&
    ref === "refs/heads/main" &&
    refType === "branch" &&
    refName === "main" &&
    workflowSha === coordinatorSha
}

/** Scheduled repair may bootstrap only an exact workflow revision on protected main. */
export function isExactMainReconciliationSchedule({ mode, eventName, ref, refType, refName, workflowSha, coordinatorSha }) {
  return mode === "current" &&
    eventName === "schedule" &&
    ref === "refs/heads/main" &&
    refType === "branch" &&
    refName === "main" &&
    workflowSha === coordinatorSha
}

/**
 * A failed first Gate A has no previously passed release tooling revision to
 * trust. The protected-main owner review is the bootstrap trust anchor for a
 * one-purpose reconciliation mode that cannot emit release candidates.
 */
export async function assertBootstrapFailedGateRecorderRevision({ coordinatorSha, mainHistory, ledger, github, ownerLogin }) {
  if (typeof coordinatorSha !== "string" || !/^[a-f0-9]{40}$/i.test(coordinatorSha)) {
    throw new TypeError("failed-gate recorder revision must be a commit SHA")
  }
  if (!Array.isArray(mainHistory) || mainHistory.length === 0 || mainHistory.at(-1) !== coordinatorSha) {
    throw new Error("failed-gate recorder must use the current main head")
  }
  if (!ledger || typeof ledger !== "object") throw new Error("failed-gate recording needs the authoritative release ledger")
  if (latestTrustedToolingSha(ledger)) throw new Error("failed-gate bootstrap is only available before trusted tooling is recorded")
  if (!github || !ownerLogin || typeof github.verifyMainReviewProtection !== "function") {
    throw new TypeError("failed-gate bootstrap needs authoritative GitHub owner and review-protection records")
  }
  await github.verifyMainReviewProtection()

  const coordinatorIndex = mainHistory.length - 1
  const watermarkIndex = mainHistory.indexOf(ledger.last_reconciled_main)
  if (watermarkIndex < 0 || watermarkIndex > coordinatorIndex) {
    throw new Error("failed-gate recorder needs a valid Pages ledger watermark in main history")
  }

  const associations = await github.pullRequestsForCommit(coordinatorSha)
  const matching = associations.filter(pr => pr.base?.ref === "main" && pr.merge_commit_sha === coordinatorSha)
  if (matching.length !== 1) throw new Error("failed-gate recorder revision must map to exactly one merged main pull request")
  const associated = matching[0]
  const pullRequest = await github.pullRequest(associated.number)
  if (!pullRequest || pullRequest.base?.ref !== "main" || !pullRequest.merged_at || pullRequest.merge_commit_sha !== coordinatorSha) {
    throw new Error("failed-gate recorder pull request metadata is incomplete")
  }
  if (!await github.ownerApprovedPullRequest(pullRequest, ownerLogin)) {
    throw new Error("failed-gate recorder pull request lacks repository-owner approval")
  }
  if (await github.gateForMainSha(coordinatorSha) !== "failed_gate") {
    throw new Error("bootstrap recorder is restricted to a terminal failed exact-SHA Gate A")
  }

  const recorded = ledger.processed_merges?.find(merge => merge.sha === coordinatorSha)
  if (recorded && (recorded.gate !== "failed_gate" || recorded.pr !== pullRequest.number)) {
    throw new Error("failed-gate recorder cannot change an existing main merge result")
  }
  if (watermarkIndex === coordinatorIndex && !recorded) {
    throw new Error("failed-gate ledger watermark has no immutable failed merge record")
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

export function assertAuthorizedReleaseTagDispatch({ actor, repositoryOwner, ref, refType, refName, sha, workflowSha, ledger }) {
  if (typeof actor !== "string" || typeof repositoryOwner !== "string" || actor.toLowerCase() !== repositoryOwner.toLowerCase()) {
    throw new Error("manual release actions require a workflow dispatch by the repository owner")
  }
  if (refType !== "tag" || ref !== `refs/tags/${refName}` ||
      !/^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(refName || "") ||
      !/^[a-f0-9]{40}$/i.test(sha || "") || workflowSha !== sha) {
    throw new Error("manual release actions must use the workflow file from an immutable desktop release tag")
  }
  if (!ledger || !Array.isArray(ledger.releases)) {
    throw new Error("manual release actions require an initialized release ledger")
  }
  const release = ledger.releases.find(item => item.tag === refName)
  if (!release || release.main_sha !== sha || release.gate !== "passed") {
    throw new Error("manual action tag must identify a Gate-A-passed release source in the authoritative ledger")
  }
  return release
}

export function assertAuthorizedMainCoordinatorDispatch({ actor, repositoryOwner, ref, refType, refName, sha, workflowSha }) {
  if (typeof actor !== "string" || typeof repositoryOwner !== "string" || actor.toLowerCase() !== repositoryOwner.toLowerCase()) {
    throw new Error("manual reconciliation requires a workflow dispatch by the repository owner")
  }
  if (refType !== "branch" || ref !== "refs/heads/main" || refName !== "main" ||
      !/^[a-f0-9]{40}$/i.test(sha || "") || workflowSha !== sha) {
    throw new Error("manual reconciliation must use the exact workflow revision from protected main")
  }
}
