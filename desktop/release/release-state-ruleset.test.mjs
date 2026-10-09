import assert from "node:assert/strict"
import test from "node:test"

import {
  RELEASE_STATE_RULESET_NAME,
  releaseStateWriterRuleset,
  validateReleaseStateRulesetCollection,
  validateReleaseStateWriterRuleset
} from "./release-state-ruleset.mjs"

test("release-state rule restricts only gh-pages to the dedicated writer App", () => {
  const expected = releaseStateWriterRuleset("481516")
  assert.deepEqual(expected, {
    name: RELEASE_STATE_RULESET_NAME,
    target: "branch",
    enforcement: "active",
    bypass_actors: [{ actor_id: 481516, actor_type: "Integration", bypass_mode: "always" }],
    conditions: { ref_name: { include: ["refs/heads/gh-pages"], exclude: [] } },
    rules: [{ type: "update", parameters: { update_allows_fetch_and_merge: false } }]
  })
  assert.equal(validateReleaseStateWriterRuleset(expected, 481516), true)
})

test("release-state ruleset rejects Actions and user bypass actors", () => {
  const expected = releaseStateWriterRuleset(481516)
  for (const bypass of [
    { actor_id: 15368, actor_type: "Integration", bypass_mode: "always" },
    { actor_id: 1, actor_type: "User", bypass_mode: "always" },
    { actor_id: 481516, actor_type: "Integration", bypass_mode: "pull_request" }
  ]) {
    assert.throws(() => validateReleaseStateWriterRuleset({ ...expected, bypass_actors: [bypass] }, 481516), /only the configured release-state writer App/)
  }
})

test("release-state ruleset rejects an unrestricted branch and extra ruleset writers", () => {
  const expected = releaseStateWriterRuleset(481516)
  assert.throws(() => validateReleaseStateWriterRuleset({
    ...expected,
    conditions: { ref_name: { include: ["~ALL"], exclude: [] } }
  }, 481516), /match only refs\/heads\/gh-pages/)
  assert.throws(() => validateReleaseStateWriterRuleset({
    ...expected,
    rules: [{ type: "deletion" }, ...expected.rules]
  }, 481516), /restrict branch updates/)
  assert.throws(() => validateReleaseStateRulesetCollection([expected, expected], 481516), /exactly one/)
})

test("release-state ruleset validates safe app IDs", () => {
  for (const id of [0, -1, "1.2", "not-an-id", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => releaseStateWriterRuleset(id), /positive integer/)
  }
})

test("release-state ruleset must be repository-scoped when checked against GitHub metadata", () => {
  const expected = {
    ...releaseStateWriterRuleset(481516),
    source_type: "Repository",
    source: "Hansespinosa2/elef"
  }
  assert.equal(validateReleaseStateRulesetCollection([expected], 481516, "Hansespinosa2/elef"), true)
  assert.throws(() => validateReleaseStateRulesetCollection([expected], 481516, "other/elef"), /belong to this repository/)
  assert.throws(() => validateReleaseStateRulesetCollection([{
    ...expected,
    source_type: "Organization",
    source: "Hansespinosa2"
  }], 481516, "Hansespinosa2/elef"), /belong to this repository/)
})
