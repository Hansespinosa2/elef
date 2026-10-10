import test from "node:test"
import assert from "node:assert/strict"

import { GitHubReleaseApi, RELEASE_GATE_JOB_NAMES } from "./github-api.mjs"

const SHA = "a".repeat(40)

test("coordinator preflight fetches and verifies the complete main review ruleset", async () => {
  const requests = []
  const ruleset = {
    id: 23894784,
    name: "main",
    target: "branch",
    enforcement: "active",
    source_type: "Repository",
    source: "example/elef",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules: [{ type: "pull_request", parameters: { required_approving_review_count: 1, require_code_owner_review: true } }]
  }
  const api = new GitHubReleaseApi({
    owner: "example",
    repository: "elef",
    token: "test-token",
    fetchImpl: async url => {
      requests.push(String(url))
      if (String(url).includes("/rulesets?")) return jsonResponse([{ id: ruleset.id, name: ruleset.name, source_type: ruleset.source_type, source: ruleset.source }])
      if (String(url).includes(`/rulesets/${ruleset.id}?`)) return jsonResponse(ruleset)
      throw new Error("unexpected API URL")
    },
    sleep: async () => {}
  })

  assert.equal(await api.verifyMainReviewProtection(), true)
  assert.equal(requests.length, 2)
  assert.match(requests[0], /rulesets\?includes_parents=true/)
  assert.match(requests[1], /rulesets\/23894784\?includes_parents=true/)
})

test("exact main SHA gate passes only when every required CI job succeeds", async () => {
  const api = new GitHubReleaseApi({
    owner: "example",
    repository: "elef",
    token: "test-token",
    fetchImpl: async (url, init) => {
      assert.equal(init.headers.Authorization, "Bearer test-token")
      assert.equal(init.headers["X-GitHub-Api-Version"], "2026-03-10")
      if (url.includes("/actions/workflows/ci.yml/runs?")) {
        assert.match(url, /head_sha=/)
        return jsonResponse({ workflow_runs: [{ id: 5, head_sha: SHA, event: "push", head_branch: "main", status: "completed", run_attempt: 2, updated_at: "2026-10-09T12:00:00Z" }] })
      }
      if (url.includes("/actions/runs/5/jobs?")) {
        return jsonResponse({ jobs: RELEASE_GATE_JOB_NAMES.map(name => ({ name, status: "completed", conclusion: "success" })) })
      }
      throw new Error("unexpected API URL")
    },
    sleep: async () => {}
  })

  assert.equal(await api.gateForMainSha(SHA), "passed")
})

test("pending checks and failed required jobs fail closed", async () => {
  let completed = false
  const api = new GitHubReleaseApi({
    owner: "example",
    repository: "elef",
    token: "test-token",
    fetchImpl: async url => {
      if (url.includes("/actions/workflows/ci.yml/runs?")) {
        return jsonResponse({ workflow_runs: completed
          ? [{ id: 8, head_sha: SHA, event: "push", head_branch: "main", status: "completed", updated_at: "2026-10-09T12:00:00Z" }]
          : [{ id: 8, head_sha: SHA, event: "push", head_branch: "main", status: "in_progress", updated_at: "2026-10-09T12:00:00Z" }] })
      }
      return jsonResponse({ jobs: RELEASE_GATE_JOB_NAMES.map((name, index) => ({
        name,
        status: "completed",
        conclusion: index === 0 ? "failure" : "success"
      })) })
    },
    sleep: async () => {}
  })
  assert.equal(await api.gateForMainSha(SHA), null)
  completed = true
  assert.equal(await api.gateForMainSha(SHA), "failed_gate")
})

test("owner approval is tied to the latest review of the merged head commit", async () => {
  const responses = [
    jsonResponse([
      { user: { login: "owner" }, state: "APPROVED", commit_id: SHA, submitted_at: "2026-10-09T10:00:00Z" },
      { user: { login: "owner" }, state: "CHANGES_REQUESTED", commit_id: SHA, submitted_at: "2026-10-09T11:00:00Z" }
    ]),
    jsonResponse([
      { user: { login: "owner" }, state: "APPROVED", commit_id: SHA, submitted_at: "2026-10-09T10:00:00Z" }
    ])
  ]
  const api = new GitHubReleaseApi({
    owner: "example",
    repository: "elef",
    token: "test-token",
    fetchImpl: async () => responses.shift(),
    sleep: async () => {}
  })
  const pullRequest = { number: 9, base: { ref: "main" }, merged_at: "2026-10-09T12:00:00Z", merge_commit_sha: SHA, head: { sha: SHA } }

  assert.equal(await api.ownerApprovedPullRequest(pullRequest, "OWNER"), false)
  assert.equal(await api.ownerApprovedPullRequest(pullRequest, "owner"), true)
})

test("safe recovery compares Git tree identities returned for exact main commits", async () => {
  const tree = "b".repeat(40)
  const api = new GitHubReleaseApi({
    owner: "example",
    repository: "elef",
    token: "test-token",
    fetchImpl: async url => {
      assert.match(url, new RegExp(`/git/commits/${SHA}$`))
      return jsonResponse({ tree: { sha: tree } })
    },
    sleep: async () => {}
  })

  assert.equal(await api.treeForCommit(SHA), tree)
  await assert.rejects(api.treeForCommit("bad-sha"), /valid SHA/)
})

test("an approval submitted after merge does not authorize a release", async () => {
  const api = new GitHubReleaseApi({
    owner: "example",
    repository: "elef",
    token: "test-token",
    fetchImpl: async () => jsonResponse([
      { user: { login: "owner" }, state: "APPROVED", commit_id: SHA, submitted_at: "2026-10-09T13:00:00Z" }
    ]),
    sleep: async () => {}
  })
  const pullRequest = { number: 10, base: { ref: "main" }, merged_at: "2026-10-09T12:00:00Z", merge_commit_sha: SHA, head: { sha: SHA } }

  assert.equal(await api.ownerApprovedPullRequest(pullRequest, "owner"), false)
})

test("an owner-authored PR requires the owner to perform the merge", async () => {
  let reviewRequests = 0
  const api = new GitHubReleaseApi({
    owner: "example",
    repository: "elef",
    token: "test-token",
    fetchImpl: async () => {
      reviewRequests += 1
      return jsonResponse([])
    },
    sleep: async () => {}
  })
  const pullRequest = {
    number: 11,
    user: { login: "OWNER" },
    merged_by: { login: "owner" },
    base: { ref: "main" },
    merged_at: "2026-10-09T12:00:00Z",
    merge_commit_sha: SHA,
    head: { sha: SHA }
  }

  assert.equal(await api.ownerApprovedPullRequest(pullRequest, "owner"), true)
  assert.equal(reviewRequests, 0, "the owner cannot submit a self-approval review")
  pullRequest.merged_by = { login: "another-maintainer" }
  assert.equal(await api.ownerApprovedPullRequest(pullRequest, "owner"), false)
})

test("transient GitHub API responses retry without exposing response bodies", async () => {
  let calls = 0
  let sleeps = 0
  const api = new GitHubReleaseApi({
    owner: "example",
    repository: "elef",
    token: "test-token",
    fetchImpl: async () => {
      calls += 1
      return calls === 1
        ? { ok: false, status: 503, headers: { get: () => null } }
        : jsonResponse({ owner: { login: "example" } })
    },
    sleep: async () => { sleeps += 1 }
  })
  assert.deepEqual(await api.repositoryInfo(), { owner: { login: "example" } })
  assert.equal(calls, 2)
  assert.equal(sleeps, 1)
})

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => value, headers: { get: () => null } }
}
