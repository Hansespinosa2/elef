import test from "node:test"
import assert from "node:assert/strict"

import { cancelInProgressDesktopReleaseRuns } from "./control-api.mjs"

test("emergency block cancellation targets only active ordinary release-coordinator runs", async () => {
  const calls = []
  const result = await cancelInProgressDesktopReleaseRuns({
    owner: "elef-owner",
    repository: "elef",
    token: "fixture-token",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options })
      if (options.method === "POST") return new Response(null, { status: 202 })
      return Response.json({ workflow_runs: [
        { id: 11, path: ".github/workflows/desktop-release.yml", status: "in_progress" },
        { id: 12, path: ".github/workflows/desktop-release-controls.yml", status: "in_progress" },
        { id: 13, path: ".github/workflows/desktop-release.yml", status: "queued" },
        { id: 14, path: ".github/workflows/desktop-release.yml", status: "in_progress" }
      ] })
    }
  })
  assert.deepEqual(result, { cancelled: 2, alreadyFinished: 0 })
  assert.match(calls[0].url, /desktop-release\.yml\/runs\?status=in_progress&per_page=100$/)
  assert.deepEqual(calls.slice(1).map(call => call.url.split("/").at(-2)), ["11", "14"])
  assert.ok(calls.every(call => call.options.headers.Authorization === "Bearer fixture-token"))
})

test("emergency block cancellation tolerates a run that completed between listing and cancel", async () => {
  const result = await cancelInProgressDesktopReleaseRuns({
    owner: "elef-owner",
    repository: "elef",
    token: "fixture-token",
    fetchImpl: async (_url, options = {}) => options.method === "POST"
      ? new Response(null, { status: 409 })
      : Response.json({ workflow_runs: [{ id: 15, path: ".github/workflows/desktop-release.yml", status: "in_progress" }] })
  })
  assert.deepEqual(result, { cancelled: 0, alreadyFinished: 1 })
})

test("emergency block cancellation fails closed on invalid or inaccessible GitHub run state", async () => {
  await assert.rejects(cancelInProgressDesktopReleaseRuns({
    owner: "elef-owner",
    repository: "elef",
    token: "fixture-token",
    fetchImpl: async () => new Response("", { status: 403 })
  }), /HTTP 403/)
  await assert.rejects(cancelInProgressDesktopReleaseRuns({
    owner: "elef-owner",
    repository: "elef",
    token: "fixture-token",
    fetchImpl: async () => Response.json({ workflow_runs: null })
  }), /invalid desktop release run metadata/)
})
