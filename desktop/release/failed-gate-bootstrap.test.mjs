import assert from "node:assert/strict"
import test from "node:test"

import { createLedger, recordFailedGateMerge } from "./ledger.mjs"
import { recordFailedGateBootstrap } from "./failed-gate-bootstrap.mjs"

const SHA0 = "0".repeat(40)
const SHA1 = "1".repeat(40)
const SHA2 = "2".repeat(40)
const SHA3 = "3".repeat(40)
const OWNER = "owner"
const NOW = "2026-10-10T09:00:00.000Z"

test("an exact-main schedule records only its failed Gate A and emits no candidates", async () => {
  const context = bootstrapContext({ failureSha: SHA1, mainHistory: [SHA0, SHA1] })
  let publication
  const result = await recordFailedGateBootstrap({
    ...context.dependencies,
    publishPages: async ({ pagesRoot, reconcile }) => {
      const record = await reconcile({ pagesRoot, attempt: 1 })
      publication = { record }
      return { published: true, attempts: 1, commitSha: SHA3 }
    }
  })

  assert.deepEqual(result.ledger.processed_merges, [{
    sha: SHA1,
    pr: 701,
    main_order: 1,
    gate: "failed_gate",
    version: null,
    tag: null,
    processed_at: NOW,
    failure_notification_acknowledged: false
  }])
  assert.equal(result.ledger.last_reconciled_main, SHA0)
  assert.equal(result.ledger.revision, 1)
  assert.deepEqual(result.ledger.reserved_versions, [])
  assert.deepEqual(result.ledger.releases, [])
  assert.equal(result.outputs.failure_only, "true")
  assert.equal(result.outputs.failure_sha_recorded, "true")
  assert.deepEqual(result.outputs.failed_notification_shas, [SHA1])
  assert.deepEqual([result.outputs.macos_candidate, result.outputs.linux_candidate, result.outputs.aur_candidate], ["", "", ""])
  assert.deepEqual([result.outputs.pending_sha, result.outputs.pending_reason], ["", ""])
  assert.equal(publication.record.pr, 701)
  assert.equal(context.calls.writerPolicy, 1)
  assert.equal(context.calls.currentMainHead, 1)
  assert.equal(context.calls.reviewProtection, 1)
})

test("an exact failed main workflow-run event records its associated PR", async () => {
  const context = bootstrapContext({
    failureSha: SHA1,
    mainHistory: [SHA0, SHA1],
    event: {
      eventName: "workflow_run",
      ref: "refs/heads/main",
      refType: "branch",
      refName: "main",
      workflowSha: SHA1,
      triggerEvent: "push",
      triggerBranch: "main",
      triggerSha: SHA1,
      gateConclusion: "failure"
    }
  })
  const result = await recordFailedGateBootstrap({
    ...context.dependencies,
    publishPages: async ({ pagesRoot, reconcile }) => {
      await reconcile({ pagesRoot, attempt: 1 })
      return { published: true, attempts: 1, commitSha: SHA3 }
    }
  })

  assert.equal(result.record.pr, 701)
  assert.deepEqual(result.ledger.processed_merges.map(({ sha, pr, gate }) => [sha, pr, gate]), [
    [SHA1, 701, "failed_gate"]
  ])
  assert.deepEqual([result.outputs.macos_candidate, result.outputs.linux_candidate, result.outputs.aur_candidate], ["", "", ""])
  assert.equal(context.calls.writerPolicy, 1)
})

test("a changed main head aborts the bootstrap before writing Pages state", async () => {
  const context = bootstrapContext({
    failureSha: SHA1,
    currentMainSha: SHA2,
    mainHistory: [SHA0, SHA1]
  })
  const initial = context.state.get()

  await assert.rejects(recordFailedGateBootstrap({
    ...context.dependencies,
    publishPages: async ({ pagesRoot, reconcile }) => {
      await reconcile({ pagesRoot, attempt: 1 })
      return { published: true, attempts: 1 }
    }
  }), /no longer the current main head/)

  assert.deepEqual(context.state.get(), initial)
  assert.equal(context.calls.writeLedger, 0)
})

test("an ineligible event is rejected before querying release state or writing Pages", async () => {
  const context = bootstrapContext({
    failureSha: SHA1,
    mainHistory: [SHA0, SHA1],
    event: {
      eventName: "workflow_dispatch",
      action: "minor",
      actor: OWNER,
      ref: "refs/heads/main",
      refType: "branch",
      refName: "main",
      workflowSha: SHA1
    }
  })
  const initial = context.state.get()

  await assert.rejects(recordFailedGateBootstrap({
    ...context.dependencies,
    publishPages: async ({ pagesRoot, reconcile }) => {
      await reconcile({ pagesRoot, attempt: 1 })
      return { published: true, attempts: 1 }
    }
  }), /event is not eligible/)

  assert.deepEqual(context.state.get(), initial)
  assert.equal(context.calls.writerPolicy, 0)
  assert.equal(context.calls.currentMainHead, 0)
  assert.equal(context.calls.writeLedger, 0)
})

test("a CAS retry rereads the winning ledger and appends only the target failure", async () => {
  const context = bootstrapContext({
    failureSha: SHA2,
    mainHistory: [SHA0, SHA1, SHA2],
    pullRequests: [
      pullRequest(701, SHA1),
      pullRequest(702, SHA2)
    ]
  })
  let attempts = 0
  const result = await recordFailedGateBootstrap({
    ...context.dependencies,
    publishPages: async ({ pagesRoot, reconcile }) => {
      attempts += 1
      await reconcile({ pagesRoot, attempt: attempts })

      // Model a competing writer winning the first push. The retry must
      // reread this newer state before appending the requested SHA.
      context.state.set(recordFailedGateMerge(context.initialLedger, {
        mainHistory: [SHA0, SHA1],
        sha: SHA1,
        pr: 701,
        expectedRevision: context.initialLedger.revision,
        at: NOW
      }))
      attempts += 1
      await reconcile({ pagesRoot, attempt: attempts })
      return { published: true, attempts, commitSha: SHA3 }
    }
  })

  assert.equal(attempts, 2)
  assert.deepEqual(result.ledger.processed_merges.map(merge => [merge.sha, merge.pr, merge.gate]), [
    [SHA1, 701, "failed_gate"],
    [SHA2, 702, "failed_gate"]
  ])
  assert.equal(result.ledger.revision, 2)
  assert.equal(result.ledger.last_reconciled_main, SHA0)
  assert.deepEqual(result.ledger.reserved_versions, [])
  assert.deepEqual(result.ledger.releases, [])
  assert.deepEqual(result.outputs.failed_notification_shas, [SHA1, SHA2])
  assert.equal(context.calls.writerPolicy, 2)
  assert.equal(context.calls.currentMainHead, 2)
})

test("a duplicate schedule run leaves the immutable failure record unchanged", async () => {
  const context = bootstrapContext({ failureSha: SHA1, mainHistory: [SHA0, SHA1] })
  const run = async () => recordFailedGateBootstrap({
    ...context.dependencies,
    publishPages: async ({ pagesRoot, reconcile }) => {
      const before = JSON.stringify(context.state.get())
      await reconcile({ pagesRoot, attempt: 1 })
      return {
        published: JSON.stringify(context.state.get()) !== before,
        attempts: 1
      }
    }
  })

  const first = await run()
  const second = await run()

  assert.equal(first.publication.published, true)
  assert.equal(second.publication.published, false)
  assert.deepEqual(second.ledger, first.ledger)
  assert.equal(second.ledger.processed_merges.length, 1)
  assert.equal(second.ledger.revision, 1)
  assert.equal(second.ledger.last_reconciled_main, SHA0)
  assert.deepEqual(second.ledger.reserved_versions, [])
  assert.deepEqual(second.ledger.releases, [])
  assert.deepEqual([second.outputs.macos_candidate, second.outputs.linux_candidate, second.outputs.aur_candidate], ["", "", ""])
})

function bootstrapContext({
  failureSha,
  currentMainSha = failureSha,
  mainHistory,
  pullRequests = [pullRequest(701, failureSha)],
  initialLedger = createLedger({ lastReconciledMain: SHA0 }),
  event = {
    eventName: "schedule",
    ref: "refs/heads/main",
    refType: "branch",
    refName: "main",
    workflowSha: failureSha
  }
}) {
  let ledger = structuredClone(initialLedger)
  const calls = { writerPolicy: 0, currentMainHead: 0, reviewProtection: 0, writeLedger: 0 }
  const github = {
    async verifyMainReviewProtection() { calls.reviewProtection += 1 },
    async pullRequestsForCommit(sha) {
      return pullRequests
        .filter(pr => pr.merge_commit_sha === sha)
        .map(pr => ({ number: pr.number, base: pr.base, merge_commit_sha: pr.merge_commit_sha }))
    },
    async pullRequest(number) { return pullRequests.find(pr => pr.number === number) || null },
    async ownerApprovedPullRequest() { return true },
    async gateForMainSha(sha) { return pullRequests.some(pr => pr.merge_commit_sha === sha) ? "failed_gate" : null }
  }

  return {
    initialLedger: structuredClone(initialLedger),
    calls,
    state: {
      get: () => ledger,
      set: value => { ledger = structuredClone(value) }
    },
    dependencies: {
      pagesRoot: "/fixture/gh-pages",
      failureSha,
      coordinatorSha: failureSha,
      ownerLogin: OWNER,
      event,
      mainHistory,
      github,
      getCurrentMainSha: async () => { calls.currentMainHead += 1; return currentMainSha },
      verifyWriterPolicy: async () => { calls.writerPolicy += 1 },
      readLedger: async () => structuredClone(ledger),
      writeLedger: async (_root, next) => { calls.writeLedger += 1; ledger = structuredClone(next) },
      now: () => NOW
    }
  }
}

function pullRequest(number, sha) {
  return {
    number,
    base: { ref: "main" },
    merged_at: NOW,
    merge_commit_sha: sha,
    head: { sha: "a".repeat(40) },
    user: { login: "contributor" }
  }
}
