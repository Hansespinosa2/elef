import test from "node:test"
import assert from "node:assert/strict"

import { createLedger, parseLedger, serializeLedger } from "./ledger.mjs"
import { reconcileReleaseLedger } from "./reconciler.mjs"

const SHA0 = "0".repeat(40)
const SHA1 = "1".repeat(40)
const SHA2 = "2".repeat(40)
const SHA3 = "3".repeat(40)
const NOW = "2026-10-09T18:00:00.000Z"

test("GitHub reconciliation follows first-parent order, records exact PR gates, and replays idempotently", async () => {
  const github = fakeGitHub({
    prs: [pull(301, SHA1), pull(302, SHA3)],
    gates: new Map([[SHA1, "failed_gate"], [SHA3, "passed"]])
  })
  const start = createLedger({ lastReconciledMain: SHA0 })
  const first = await reconcileReleaseLedger({
    ledger: start,
    mainHistory: [SHA0, SHA1, SHA3],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })
  assert.deepEqual(first.processedMerges.map(merge => [merge.pr, merge.sha, merge.gate, merge.version]), [
    [301, SHA1, "failed_gate", null],
    [302, SHA3, "passed", "0.1.0"]
  ])
  assert.equal(first.ledger.last_reconciled_main, SHA3)

  const replayed = await reconcileReleaseLedger({
    ledger: first.ledger,
    mainHistory: [SHA0, SHA1, SHA3],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })
  assert.deepEqual(replayed.ledger, first.ledger)
  assert.deepEqual(replayed.processedMerges, [])
})

test("a pending exact-SHA main gate stops the watermark before that merge", async () => {
  const github = fakeGitHub({
    prs: [pull(401, SHA1), pull(402, SHA3)],
    gates: new Map([[SHA1, "passed"], [SHA3, null]])
  })
  const start = createLedger({ lastReconciledMain: SHA0 })
  const result = await reconcileReleaseLedger({
    ledger: start,
    mainHistory: [SHA0, SHA1, SHA3],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })
  assert.equal(result.pendingSha, SHA3)
  assert.equal(result.pendingReason, "gate_pending")
  assert.equal(result.ledger.last_reconciled_main, SHA1)
  assert.deepEqual(result.ledger.releases.map(release => release.version), ["0.1.0"])
})

test("an unassociated main commit blocks the watermark until its PR record is available", async () => {
  const github = fakeGitHub({ prs: [pull(601, SHA3)], gates: new Map([[SHA3, "passed"]]) })
  const result = await reconcileReleaseLedger({
    ledger: createLedger({ lastReconciledMain: SHA0 }),
    mainHistory: [SHA0, SHA2, SHA3],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })
  assert.equal(result.pendingSha, SHA2)
  assert.equal(result.pendingReason, "pr_association_unavailable")
  assert.equal(result.ledger.last_reconciled_main, SHA0)
  assert.equal(result.ledger.releases.length, 0)
})

test("an incomplete associated PR record blocks the watermark instead of skipping the merge", async () => {
  const github = {
    pullRequestsForCommit: async () => [pull(602, SHA2)],
    pullRequest: async () => null,
    versionTags: async () => []
  }
  const result = await reconcileReleaseLedger({
    ledger: createLedger({ lastReconciledMain: SHA0 }),
    mainHistory: [SHA0, SHA2],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })
  assert.equal(result.pendingSha, SHA2)
  assert.equal(result.pendingReason, "pr_record_unavailable")
  assert.equal(result.ledger.last_reconciled_main, SHA0)
})

test("only a current owner approval is eligible and a missing history anchor fails closed", async () => {
  const github = fakeGitHub({ prs: [pull(501, SHA1)], gates: new Map([[SHA1, "passed"]]), approved: false })
  const result = await reconcileReleaseLedger({
    ledger: createLedger({ lastReconciledMain: SHA0 }),
    mainHistory: [SHA0, SHA1],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })
  assert.deepEqual(result.unapprovedMerges, [{ pr: 501, sha: SHA1 }])
  assert.equal(result.ledger.releases.length, 0)
  await assert.rejects(reconcileReleaseLedger({
    ledger: createLedger({ lastReconciledMain: "9".repeat(40) }),
    mainHistory: [SHA0, SHA1],
    github,
    ownerLogin: "owner"
  }), /not in current first-parent history/)
})

test("an unapproved merge stops reconciliation before every descendant merge", async () => {
  const first = pull(511, SHA1)
  const unauthorized = pull(512, SHA2)
  const descendant = pull(513, SHA3)
  const github = fakeGitHub({
    prs: [first, unauthorized, descendant],
    gates: new Map([[SHA1, "passed"], [SHA2, "passed"], [SHA3, "passed"]]),
    approved: pr => pr.number !== unauthorized.number
  })
  const result = await reconcileReleaseLedger({
    ledger: createLedger({ lastReconciledMain: SHA0 }),
    mainHistory: [SHA0, SHA1, SHA2, SHA3],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })

  assert.equal(result.pendingSha, SHA2)
  assert.equal(result.pendingReason, "unapproved_pr")
  assert.deepEqual(result.unapprovedMerges, [{ pr: unauthorized.number, sha: SHA2 }])
  assert.equal(result.ledger.last_reconciled_main, SHA1)
  assert.deepEqual(result.ledger.releases.map(release => [release.pr, release.main_sha, release.version]), [
    [first.number, SHA1, "0.1.0"]
  ])
})

test("an owner-approved exact-tree recovery records the held interval and resumes in merge order", async () => {
  const held = pull(521, SHA1)
  const recovery = pull(522, SHA2)
  const next = pull(523, SHA3)
  const safeTree = "a".repeat(40)
  const github = fakeGitHub({
    prs: [held, recovery, next],
    gates: new Map([[SHA2, "passed"], [SHA3, "passed"]]),
    approved: pr => pr.number !== held.number,
    trees: new Map([[SHA0, safeTree], [SHA1, "b".repeat(40)], [SHA2, safeTree], [SHA3, "c".repeat(40)]])
  })
  const result = await reconcileReleaseLedger({
    ledger: createLedger({ lastReconciledMain: SHA0 }),
    mainHistory: [SHA0, SHA1, SHA2, SHA3],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })

  assert.equal(result.pendingSha, null)
  assert.deepEqual(result.unapprovedMerges, [{ pr: held.number, sha: SHA1 }])
  assert.deepEqual(result.processedMerges.map(merge => [merge.pr, merge.sha, merge.gate, merge.version]), [
    [recovery.number, SHA2, "passed", "0.1.0"],
    [next.number, SHA3, "passed", "0.1.1"]
  ])
  assert.deepEqual(result.ledger.recovery_events, [{
    base_sha: SHA0,
    safe_tree_sha: safeTree,
    recovery_tree_sha: safeTree,
    held_merges: [{ pr: held.number, sha: SHA1, owner_approved: false }],
    recovery_pr: recovery.number,
    recovery_sha: SHA2,
    recovery_owner_approved: true,
    recovered_at: NOW
  }])
  assert.deepEqual(parseLedger(serializeLedger(result.ledger)), result.ledger)

  const replayed = await reconcileReleaseLedger({
    ledger: result.ledger,
    mainHistory: [SHA0, SHA1, SHA2, SHA3],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })
  assert.deepEqual(replayed.ledger, result.ledger)
})

test("a tree match without owner approval cannot recover a held main interval", async () => {
  const held = pull(531, SHA1)
  const unapprovedRestore = pull(532, SHA2)
  const descendant = pull(533, SHA3)
  const safeTree = "a".repeat(40)
  const github = fakeGitHub({
    prs: [held, unapprovedRestore, descendant],
    gates: new Map([[SHA2, "passed"], [SHA3, "passed"]]),
    approved: pr => pr.number === descendant.number,
    trees: new Map([[SHA0, safeTree], [SHA1, "b".repeat(40)], [SHA2, safeTree], [SHA3, "c".repeat(40)]])
  })
  const result = await reconcileReleaseLedger({
    ledger: createLedger({ lastReconciledMain: SHA0 }),
    mainHistory: [SHA0, SHA1, SHA2, SHA3],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })

  assert.equal(result.pendingSha, SHA1)
  assert.equal(result.pendingReason, "unapproved_pr")
  assert.deepEqual(result.ledger.releases, [])
  assert.deepEqual(result.ledger.recovery_events, [])
})

test("an empty Pages ledger anchors to current main without retroactively releasing history", async () => {
  const result = await reconcileReleaseLedger({
    ledger: null,
    mainHistory: [SHA0, SHA1, SHA2],
    github: {},
    ownerLogin: "owner"
  })
  assert.equal(result.initialized, true)
  assert.equal(result.ledger.last_reconciled_main, SHA2)
  assert.equal(result.ledger.releases.length, 0)
})

function pull(number, sha) {
  return {
    number,
    base: { ref: "main" },
    merged_at: NOW,
    merge_commit_sha: sha,
    head: { sha: `${number}`.padStart(40, "a").slice(-40) }
  }
}

function fakeGitHub({ prs = [], gates = new Map(), approved = true, trees = new Map() }) {
  const prsBySha = new Map(prs.map(pr => [pr.merge_commit_sha, pr]))
  return {
    pullRequestsForCommit: async sha => {
      const pr = prsBySha.get(sha)
      return pr ? [pr] : []
    },
    pullRequest: async number => prs.find(pr => pr.number === number),
    ownerApprovedPullRequest: async pr => typeof approved === "function" ? approved(pr) : approved,
    gateForMainSha: async sha => gates.get(sha) ?? null,
    treeForCommit: async sha => trees.get(sha) ?? sha,
    versionTags: async () => []
  }
}
