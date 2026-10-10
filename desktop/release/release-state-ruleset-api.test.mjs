import assert from "node:assert/strict"
import test from "node:test"

import { releaseStateWriterRuleset } from "./release-state-ruleset.mjs"
import { verifyReleaseStateWriterPolicy } from "./release-state-ruleset-api.mjs"

const RULESET_UPDATED_AT = "2026-10-10T12:00:00.000Z"

test("release publication checks the active repository and inherited rulesets", async () => {
  const calls = []
  const ruleset = {
    ...releaseStateWriterRuleset(481516),
    id: 73,
    source_type: "Repository",
    source: "Hansespinosa2/elef"
  }
  const summary = { id: 73, name: ruleset.name, source_type: ruleset.source_type, source: ruleset.source }
  const verified = await verifyReleaseStateWriterPolicy({
    repository: "Hansespinosa2/elef",
    appId: 481516,
    token: "read-token-fixture",
    expectedUpdatedAt: RULESET_UPDATED_AT,
    apiUrl: "https://api.github.com",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return Response.json(calls.length === 1 ? [summary] : { ...ruleset, updated_at: RULESET_UPDATED_AT })
    }
  })

  assert.deepEqual(verified, { id: 73, name: "desktop-release-state-writer" })
  assert.equal(calls[0].url, "https://api.github.com/repos/Hansespinosa2/elef/rulesets?per_page=100&includes_parents=true")
  assert.equal(calls[1].url, "https://api.github.com/repos/Hansespinosa2/elef/rulesets/73?includes_parents=true")
  for (const call of calls) {
    assert.equal(call.options.headers.authorization, "Bearer read-token-fixture")
    assert.equal(call.options.headers["x-github-api-version"], "2022-11-28")
  }
})

test("release publication fails closed on a broad or changed bypass rule", async () => {
  const wrongApp = { ...releaseStateWriterRuleset(481516), id: 73, source_type: "Repository", source: "Hansespinosa2/elef", bypass_actors: [
    { actor_id: 15368, actor_type: "Integration", bypass_mode: "always" }
  ] }
  let callCount = 0
  await assert.rejects(verifyReleaseStateWriterPolicy({
    repository: "Hansespinosa2/elef",
    appId: 481516,
    token: "read-token-fixture",
    expectedUpdatedAt: RULESET_UPDATED_AT,
    fetchImpl: async () => Response.json(callCount++ === 0
      ? [{ id: 73, name: wrongApp.name, source_type: "Repository", source: "Hansespinosa2/elef" }]
      : { ...wrongApp, updated_at: RULESET_UPDATED_AT })
  }), /only the configured release-state writer App/)
})

test("release publication stops if the branch rule is absent or GitHub cannot verify it", async () => {
  const input = { repository: "Hansespinosa2/elef", appId: 481516, token: "read-token-fixture", expectedUpdatedAt: RULESET_UPDATED_AT }
  await assert.rejects(verifyReleaseStateWriterPolicy({ ...input, fetchImpl: async () => Response.json([]) }), /exactly one/)
  let callCount = 0
  await assert.rejects(verifyReleaseStateWriterPolicy({
    ...input,
    fetchImpl: async () => ++callCount === 1
      ? Response.json([{ id: 73, name: "desktop-release-state-writer", source_type: "Repository", source: "Hansespinosa2/elef" }])
      : new Response("", { status: 503 })
  }), /HTTP 503/)
  await assert.rejects(verifyReleaseStateWriterPolicy({ ...input, fetchImpl: async () => { throw new Error("secret transport detail") } }), /could not confirm/)
})

test("release publication rejects a duplicate or non-repository matching rule", async () => {
  const summary = { id: 73, name: "desktop-release-state-writer" }
  await assert.rejects(verifyReleaseStateWriterPolicy({
    repository: "Hansespinosa2/elef",
    appId: 481516,
    token: "read-token-fixture",
    fetchImpl: async () => Response.json([summary, { ...summary, id: 74 }])
  }), /exactly one/)

  let callCount = 0
  await assert.rejects(verifyReleaseStateWriterPolicy({
    repository: "Hansespinosa2/elef",
    appId: 481516,
    token: "read-token-fixture",
    fetchImpl: async () => Response.json(callCount++ === 0 ? [summary] : {
      ...releaseStateWriterRuleset(481516),
      id: 73,
      source_type: "Organization",
      source: "Hansespinosa2",
      updated_at: RULESET_UPDATED_AT
    })
  }), /belong to this repository/)
})

test("Contents-only ruleset readback uses the administrator-pinned revision when GitHub omits bypass actors", async () => {
  const hiddenBypass = {
    ...releaseStateWriterRuleset(481516),
    id: 73,
    source_type: "Repository",
    source: "Hansespinosa2/elef",
    updated_at: RULESET_UPDATED_AT
  }
  delete hiddenBypass.bypass_actors
  let callCount = 0
  const input = {
    repository: "Hansespinosa2/elef",
    appId: 481516,
    token: "contents-only-app-token",
    expectedUpdatedAt: RULESET_UPDATED_AT,
    fetchImpl: async () => Response.json(callCount++ === 0
      ? [{ id: 73, name: hiddenBypass.name, source_type: "Repository", source: "Hansespinosa2/elef" }]
      : hiddenBypass)
  }
  assert.deepEqual(await verifyReleaseStateWriterPolicy(input), { id: 73, name: "desktop-release-state-writer" })

  callCount = 0
  await assert.rejects(verifyReleaseStateWriterPolicy({
    ...input,
    expectedUpdatedAt: "2026-10-10T12:01:00.000Z"
  }), /changed since administrator verification/)
})
