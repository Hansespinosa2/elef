import assert from "node:assert/strict"
import test from "node:test"

import { createLedger, reconcileMain } from "./ledger.mjs"
import { assertAuthorizedMainCoordinatorDispatch, assertAuthorizedReleaseTagDispatch, assertTrustedCoordinatorRevision, latestTrustedToolingSha, selectTrustedCoordinatorRevision } from "./coordinator-trust.mjs"

const SHA0 = "0".repeat(40)
const SHA1 = "1".repeat(40)
const SHA2 = "2".repeat(40)
const SHA3 = "3".repeat(40)
const NOW = "2026-10-10T09:00:00.000Z"

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

test("coordinator tooling is trusted only at its owner-approved exact-SHA passing main merge", async () => {
  const ledger = createLedger({ lastReconciledMain: SHA0 })
  const result = await assertTrustedCoordinatorRevision({
    coordinatorSha: SHA1,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github: fakeGitHub([pull(101, SHA1), pull(102, SHA2)], {
      gates: new Map([[SHA1, "passed"], [SHA2, null]])
    }),
    ownerLogin: "owner"
  })
  assert.deepEqual(result, { sha: SHA1, pr: 101 })
  assert.deepEqual(await selectTrustedCoordinatorRevision({
    coordinatorSha: SHA1,
    mainHistory: [SHA0, SHA1, SHA2],
    ledger,
    github: fakeGitHub([pull(101, SHA1), pull(102, SHA2)], { gates: new Map([[SHA1, "passed"], [SHA2, null]]) }),
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
    pullRequestsForCommit: async sha => bySha.has(sha) ? [bySha.get(sha)] : [],
    pullRequest: async number => prs.find(pr => pr.number === number) || null,
    ownerApprovedPullRequest: async pr => typeof approved === "function" ? approved(pr) : approved,
    gateForMainSha: async sha => gates.get(sha) ?? null,
    treeForCommit: async sha => trees.get(sha) || sha,
    versionTags: async () => []
  }
}
