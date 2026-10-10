import assert from "node:assert/strict"
import test from "node:test"

import { ensureGateFailureIssue, gateFailureIssueTitle } from "./gate-failure-notifier.mjs"

const SHA = "a".repeat(40)
const OWNER = "Hansespinosa2"
const REPOSITORY = `${OWNER}/elef`
const RUN_URL = `https://github.com/${REPOSITORY}/actions/runs/123`
const ISSUE_URL = `https://github.com/${REPOSITORY}/issues/456`

function issue(overrides = {}) {
  return {
    number: 456,
    title: gateFailureIssueTitle(SHA),
    state: "open",
    html_url: ISSUE_URL,
    assignees: [{ login: OWNER }],
    ...overrides
  }
}

test("owner-directed Gate A issue uses a stable title, exact SHA, run link, and owner assignment", async () => {
  const calls = []
  const result = await ensureGateFailureIssue({
    repository: REPOSITORY,
    ownerLogin: OWNER,
    token: "issues-write-token",
    sha: SHA,
    runUrl: RUN_URL,
    detail: "The ledger is pending at an earlier merge.",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      if (options.method === "POST") return Response.json(issue(), { status: 201 })
      return Response.json({ items: [] })
    }
  })

  assert.deepEqual(result, { number: 456, url: ISSUE_URL, created: true })
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /\/search\/issues\?q=/)
  assert.equal(calls[1].url, `https://api.github.com/repos/${REPOSITORY}/issues`)
  const payload = JSON.parse(calls[1].options.body)
  assert.equal(payload.title, gateFailureIssueTitle(SHA))
  assert.deepEqual(payload.assignees, [OWNER])
  assert.match(payload.body, new RegExp(`@${OWNER}`))
  assert.match(payload.body, new RegExp(SHA))
  assert.match(payload.body, new RegExp(RUN_URL.replaceAll("/", "\\/")))
})

test("retry reuses an existing owner-assigned open alert without creating a duplicate", async () => {
  const calls = []
  const result = await ensureGateFailureIssue({
    repository: REPOSITORY,
    ownerLogin: OWNER,
    token: "issues-write-token",
    sha: SHA,
    runUrl: RUN_URL,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return Response.json({ items: [issue()] })
    }
  })
  assert.deepEqual(result, { number: 456, url: ISSUE_URL, created: false })
  assert.equal(calls.length, 1)
})

test("retry reopens and assigns an existing alert before acknowledging it", async () => {
  const calls = []
  const result = await ensureGateFailureIssue({
    repository: REPOSITORY,
    ownerLogin: OWNER,
    token: "issues-write-token",
    sha: SHA,
    runUrl: RUN_URL,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      if (options.method === "PATCH") return Response.json(issue())
      return Response.json({ items: [issue({ state: "closed", assignees: [] })] })
    }
  })
  assert.deepEqual(result, { number: 456, url: ISSUE_URL, created: false })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, `https://api.github.com/repos/${REPOSITORY}/issues/456`)
  assert.deepEqual(JSON.parse(calls[1].options.body), { state: "open", assignees: [OWNER] })
})

test("notification fails closed when GitHub does not confirm owner assignment", async () => {
  await assert.rejects(ensureGateFailureIssue({
    repository: REPOSITORY,
    ownerLogin: OWNER,
    token: "issues-write-token",
    sha: SHA,
    runUrl: RUN_URL,
    fetchImpl: async (_url, options) => options.method === "POST"
      ? Response.json(issue({ assignees: [] }), { status: 201 })
      : Response.json({ items: [] })
  }), /did not confirm assignment/)
})
