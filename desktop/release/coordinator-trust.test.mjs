import assert from "node:assert/strict"
import test from "node:test"

import { createLedger, reconcileMain } from "./ledger.mjs"
import { assertAuthorizedMainCoordinatorDispatch, assertAuthorizedReleaseTagDispatch, assertBootstrapFailedGateRecorderRevision, assertMainReviewProtection, assertTrustedCoordinatorRevision, isExactFailedMainReconcileDispatch, isExactFailedMainWorkflowRun, latestTrustedToolingSha, selectTrustedCoordinatorRevision } from "./coordinator-trust.mjs"

const SHA0 = "0".repeat(40)
const SHA1 = "1".repeat(40)
const SHA2 = "2".repeat(40)
const SHA3 = "3".repeat(40)
const NOW = "2026-10-10T09:00:00.000Z"

test("main coordinator trust requires effective approval and CODEOWNERS review rules", () => {
  const reviewRule = {
    type: "pull_request",
    ruleset_source_type: "Repository",
    ruleset_source: "owner/elef",
    parameters: { required_approving_review_count: 1, require_code_owner_review: true }
  }
  assert.equal(assertMainReviewProtection([reviewRule]), true)
  for (const invalid of [
    { ...reviewRule, parameters: { required_approving_review_count: 0, require_code_owner_review: true } },
    { ...reviewRule, parameters: { required_approving_review_count: 1, require_code_owner_review: false } },
    { ...reviewRule, type: "required_status_checks" }
  ]) {
    assert.throws(() => assertMainReviewProtection([invalid]))
  }
  assert.throws(() => assertMainReviewProtection([]), /effective main branch rules/)
})

test("manual release actions require the owner, immutable version tag and Gate-A-passed ledger source", () => {
  const release = { version: "0.1.0", tag: "desktop-v0.1.0", main_sha: SHA1, gate: "passed" }
  const ledger = { releases: [release] }
  const dispatch = {
    actor: "OWNER",
    repositoryOwner: "owner",
    ref: "refs/tags/desktop-v0.1.0",
    refType: "tag",
    refName: "desktop-v0.1.0",
    sha: SHA1,
    workflowSha: SHA1,
    ledger
  }
  assert.equal(assertAuthorizedReleaseTagDispatch(dispatch), release)
  for (const invalid of [
    { ...dispatch, actor: "other" },
    { ...dispatch, refType: "branch" },
    { ...dispatch, ref: "refs/heads/main" },
    { ...dispatch, refName: "desktop-v0.1.1" },
    { ...dispatch, workflowSha: SHA2 },
    { ...dispatch, sha: SHA2 },
    { ...dispatch, ledger: { releases: [{ ...release, gate: "failed_gate" }] } }
  ]) {
    assert.throws(() => assertAuthorizedReleaseTagDispatch(invalid))
  }
})

test("manual reconciliation recovery is owner-only and bound to the exact main workflow revision", () => {
  const dispatch = {
    actor: "Hansespinosa2",
    repositoryOwner: "hansespinosa2",
    ref: "refs/heads/main",
    refType: "branch",
    refName: "main",
    sha: SHA1,
    workflowSha: SHA1
  }
  assert.doesNotThrow(() => assertAuthorizedMainCoordinatorDispatch(dispatch))
  for (const invalid of [
    { ...dispatch, actor: "other" },
    { ...dispatch, ref: "refs/tags/desktop-v0.1.0" },
    { ...dispatch, refType: "tag" },
    { ...dispatch, refName: "dev" },
    { ...dispatch, workflowSha: SHA2 },
    { ...dispatch, sha: "invalid" }
  ]) {
    assert.throws(() => assertAuthorizedMainCoordinatorDispatch(invalid))
  }
})

test("coordinator tooling is trusted at an owner-approved exact-SHA dev-to-main promotion", async () => {
  const ledger = createLedger({ lastReconciledMain: SHA0 })
  const promotion = { ...pull(101, SHA1), head: { ref: "dev", sha: pull(101, SHA1).head.sha } }
  const prs = [promotion, pull(102, SHA2)]
  const result = await assertTrustedCoordinatorRevision({
    coordinatorSha: SHA1,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github: fakeGitHub(prs, {
      gates: new Map([[SHA1, "passed"], [SHA2, null]])
    }),
    ownerLogin: "owner"
  })
  assert.deepEqual(result, { sha: SHA1, pr: 101 })
  assert.deepEqual(await selectTrustedCoordinatorRevision({
    coordinatorSha: SHA1,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github: fakeGitHub(prs, { gates: new Map([[SHA1, "passed"], [SHA2, null]]) }),
    ownerLogin: "owner"
  }), { sha: SHA1, pr: 101, selectedFrom: "event" })
})

test("failed or pending event Gate A falls back to the latest recorded trusted tooling SHA", async () => {
  let ledger = createLedger({ lastReconciledMain: SHA0 })
  ledger = reconcileMain(ledger, {
    mainHistory: [SHA0, SHA1],
    merges: [{ base: "main", merged: true, approved: true, pr: 151, sha: SHA1, gate: "passed" }],
    expectedRevision: ledger.revision,
    now: () => NOW
  })
  const github = fakeGitHub([pull(151, SHA1), pull(152, SHA2)], {
    gates: new Map([[SHA1, "passed"], [SHA2, "failed_gate"]])
  })
  assert.deepEqual(await selectTrustedCoordinatorRevision({
    coordinatorSha: SHA2,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github,
    ownerLogin: "owner"
  }), { sha: SHA1, pr: 151, selectedFrom: "ledger", rejectedEventReason: "coordinator revision has not passed the exact-SHA main release gate" })

  github.gateForMainSha = async sha => sha === SHA2 ? null : "passed"
  assert.equal((await selectTrustedCoordinatorRevision({
    coordinatorSha: SHA2,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github,
    ownerLogin: "owner"
  })).sha, SHA1)
})

test("the protected-main owner approval can bootstrap a failure-only recorder for the first failed Gate A", async () => {
  const initial = createLedger({ lastReconciledMain: SHA0 })
  const github = fakeGitHub([pull(601, SHA1)], { gates: new Map([[SHA1, "failed_gate"]]) })
  const arguments_ = {
    coordinatorSha: SHA1,
    mainHistory: [SHA0, SHA1],
    ledger: initial,
    github,
    ownerLogin: "owner"
  }
  assert.deepEqual(await assertBootstrapFailedGateRecorderRevision(arguments_), { sha: SHA1, pr: 601 })

  const recorded = reconcileMain(initial, {
    mainHistory: [SHA0, SHA1],
    merges: [{ base: "main", merged: true, approved: true, pr: 601, sha: SHA1, gate: "failed_gate" }],
    expectedRevision: initial.revision,
    now: () => NOW
  })
  assert.deepEqual(await assertBootstrapFailedGateRecorderRevision({ ...arguments_, ledger: recorded }), { sha: SHA1, pr: 601 })
})

test("failure-only bootstrap accepts only a failed exact current-main push workflow run", () => {
  const event = {
    mode: "current",
    eventName: "workflow_run",
    triggerEvent: "push",
    triggerBranch: "main",
    triggerSha: SHA1,
    gateConclusion: "failure",
    ref: "refs/heads/main",
    refType: "branch",
    refName: "main",
    workflowSha: SHA1,
    coordinatorSha: SHA1
  }
  assert.equal(isExactFailedMainWorkflowRun(event), true)
  assert.equal(isExactFailedMainWorkflowRun({ ...event, gateConclusion: "cancelled" }), true)

  for (const change of [
    { mode: "latest" },
    { eventName: "workflow_dispatch" },
    { triggerEvent: "pull_request" },
    { triggerBranch: "feature" },
    { triggerSha: SHA2 },
    { gateConclusion: "success" },
    { gateConclusion: "" },
    { ref: "refs/heads/feature" },
    { refType: "tag" },
    { refName: "feature" },
    { workflowSha: SHA2 },
    { coordinatorSha: SHA2 }
  ]) {
    assert.equal(isExactFailedMainWorkflowRun({ ...event, ...change }), false, JSON.stringify(change))
  }
})

test("owner reconcile dispatch can replay a failed current-main Gate A but minor controls cannot", () => {
  const dispatch = {
    mode: "current",
    eventName: "workflow_dispatch",
    action: "reconcile",
    actor: "Hansespinosa2",
    ownerLogin: "hansespinosa2",
    ref: "refs/heads/main",
    refType: "branch",
    refName: "main",
    workflowSha: SHA1,
    coordinatorSha: SHA1
  }
  assert.equal(isExactFailedMainReconcileDispatch(dispatch), true)
  for (const change of [
    { mode: "latest" },
    { eventName: "workflow_run" },
    { action: "minor" },
    { actor: "other" },
    { ref: "refs/heads/feature" },
    { refType: "tag" },
    { refName: "dev" },
    { workflowSha: SHA2 },
    { coordinatorSha: SHA2 }
  ]) {
    assert.equal(isExactFailedMainReconcileDispatch({ ...dispatch, ...change }), false, JSON.stringify(change))
  }
})

test("failure-only bootstrap rejects pending, passed, unapproved, stale, or already-trusted candidates", async () => {
  const makeArguments = ({ gate = "failed_gate", approved = true, coordinatorSha = SHA1, ledger = createLedger({ lastReconciledMain: SHA0 }), mainHistory } = {}) => ({
    coordinatorSha,
    mainHistory: mainHistory || (coordinatorSha === SHA2 ? [SHA0, SHA1, SHA2] : [SHA0, SHA1]),
    ledger,
    github: fakeGitHub([pull(602, SHA1), pull(603, SHA2)], {
      approved,
      gates: new Map([[SHA1, gate], [SHA2, "failed_gate"]])
    }),
    ownerLogin: "owner"
  })

  await assert.rejects(assertBootstrapFailedGateRecorderRevision(makeArguments({ gate: null })), /terminal failed exact-SHA Gate A/)
  await assert.rejects(assertBootstrapFailedGateRecorderRevision(makeArguments({ gate: "passed" })), /terminal failed exact-SHA Gate A/)
  await assert.rejects(assertBootstrapFailedGateRecorderRevision(makeArguments({ approved: false })), /lacks repository-owner approval/)
  await assert.rejects(assertBootstrapFailedGateRecorderRevision(makeArguments({ coordinatorSha: SHA1, mainHistory: [SHA0, SHA1, SHA2] })), /current main head/)

  let trustedLedger = createLedger({ lastReconciledMain: SHA0 })
  trustedLedger = reconcileMain(trustedLedger, {
    mainHistory: [SHA0, SHA1],
    merges: [{ base: "main", merged: true, approved: true, pr: 604, sha: SHA1, gate: "passed" }],
    expectedRevision: trustedLedger.revision,
    now: () => NOW
  })
  await assert.rejects(assertBootstrapFailedGateRecorderRevision(makeArguments({
    coordinatorSha: SHA2,
    ledger: trustedLedger
  })), /only available before trusted tooling/)
})

test("coordinator trust fails closed on pending or failed exact-SHA checks", async () => {
  for (const gate of [null, "failed_gate"]) {
    await assert.rejects(assertTrustedCoordinatorRevision({
      coordinatorSha: SHA1,
      mainHistory: [SHA0, SHA1],
      ledger: createLedger({ lastReconciledMain: SHA0 }),
      github: fakeGitHub([pull(201, SHA1)], { gates: new Map([[SHA1, gate]]) }),
      ownerLogin: "owner"
    }), /exact-SHA main release gate/)
  }
})

test("coordinator trust rejects an unapproved merge in its source history", async () => {
  const ledger = createLedger({ lastReconciledMain: SHA0 })
  const unauthorized = pull(301, SHA1)
  const coordinator = pull(302, SHA2)
  await assert.rejects(assertTrustedCoordinatorRevision({
    coordinatorSha: SHA2,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github: fakeGitHub([unauthorized, coordinator], {
      approved: pr => pr.number !== unauthorized.number,
      gates: new Map([[SHA1, "passed"], [SHA2, "passed"]])
    }),
    ownerLogin: "owner"
  }), /unresolved or unauthorized main merge/)
})

test("an approved safe-tree recovery makes its exact passing revision trusted", async () => {
  const ledger = createLedger({ lastReconciledMain: SHA0 })
  const held = pull(401, SHA1)
  const recovery = pull(402, SHA2)
  const safeTree = "a".repeat(40)
  const result = await assertTrustedCoordinatorRevision({
    coordinatorSha: SHA2,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github: fakeGitHub([held, recovery], {
      approved: pr => pr.number !== held.number,
      gates: new Map([[SHA1, "passed"], [SHA2, "passed"]]),
      trees: new Map([[SHA0, safeTree], [SHA1, "b".repeat(40)], [SHA2, safeTree]])
    }),
    ownerLogin: "owner"
  })
  assert.deepEqual(result, { sha: SHA2, pr: 402 })
})

test("an already processed coordinator SHA must have a passed immutable ledger record", async () => {
  let ledger = createLedger({ lastReconciledMain: SHA0 })
  ledger = reconcileMain(ledger, {
    mainHistory: [SHA0, SHA1, SHA2],
    merges: [{ base: "main", merged: true, approved: true, pr: 501, sha: SHA1, gate: "passed" }],
    expectedRevision: ledger.revision,
    now: () => NOW
  })
  ledger.last_reconciled_main = SHA2
  assert.deepEqual(await assertTrustedCoordinatorRevision({
    coordinatorSha: SHA1,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github: fakeGitHub([pull(501, SHA1)], { gates: new Map([[SHA1, "passed"]]) }),
    ownerLogin: "owner"
  }), { sha: SHA1, pr: 501 })

  ledger.processed_merges = []
  await assert.rejects(assertTrustedCoordinatorRevision({
    coordinatorSha: SHA1,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github: fakeGitHub([pull(501, SHA1)], { gates: new Map([[SHA1, "passed"]]) }),
    ownerLogin: "owner"
  }), /advanced past an unverified/)
})

test("latest tooling selection uses the newest recorded Gate-A-passed merge", () => {
  assert.equal(latestTrustedToolingSha({
    processed_merges: [
      { sha: SHA1, gate: "passed", main_order: 1 },
      { sha: SHA2, gate: "failed_gate", main_order: 2 },
      { sha: SHA3, gate: "passed", main_order: 3 }
    ]
  }), SHA3)
  assert.equal(latestTrustedToolingSha({ processed_merges: [] }), null)
})

function pull(number, sha) {
  return {
    number,
    base: { ref: "main" },
    merged_at: NOW,
    merge_commit_sha: sha,
    head: { sha: String(number).padStart(40, "a").slice(-40) }
  }
}

function fakeGitHub(prs, { gates = new Map(), approved = true, trees = new Map() } = {}) {
  const bySha = new Map(prs.map(pr => [pr.merge_commit_sha, pr]))
  return {
    verifyMainReviewProtection: async () => true,
    pullRequestsForCommit: async sha => bySha.has(sha) ? [bySha.get(sha)] : [],
    pullRequest: async number => prs.find(pr => pr.number === number) || null,
    ownerApprovedPullRequest: async pr => typeof approved === "function" ? approved(pr) : approved,
    gateForMainSha: async sha => gates.get(sha) ?? null,
    treeForCommit: async sha => trees.get(sha) || sha,
    versionTags: async () => []
  }
}
