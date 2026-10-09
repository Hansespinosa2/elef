import test from "node:test"
import assert from "node:assert/strict"

import { createLedger } from "./ledger.mjs"
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
    mainHistory: [SHA0, SHA1, SHA2, SHA3],
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
    mainHistory: [SHA0, SHA1, SHA2, SHA3],
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
    mainHistory: [SHA0, SHA1, SHA2, SHA3],
    github,
    ownerLogin: "owner",
    now: () => NOW
  })
  assert.equal(result.pendingSha, SHA3)
  assert.equal(result.ledger.last_reconciled_main, SHA2)
  assert.deepEqual(result.ledger.releases.map(release => release.version), ["0.1.0"])
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

function fakeGitHub({ prs = [], gates = new Map(), approved = true }) {
  const prsBySha = new Map(prs.map(pr => [pr.merge_commit_sha, pr]))
  return {
    pullRequestsForCommit: async sha => {
      const pr = prsBySha.get(sha)
      return pr ? [pr] : []
    },
    pullRequest: async number => prs.find(pr => pr.number === number),
    ownerApprovedPullRequest: async () => approved,
    gateForMainSha: async sha => gates.get(sha) ?? null,
    versionTags: async () => []
  }
}
