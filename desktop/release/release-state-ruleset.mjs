export const RELEASE_STATE_RULESET_NAME = "desktop-release-state-writer"

export function releaseStateWriterRuleset(appId) {
  const integrationId = Number(appId)
  if (!Number.isSafeInteger(integrationId) || integrationId < 1) {
    throw new TypeError("release-state writer App ID must be a positive integer")
  }

  return {
    name: RELEASE_STATE_RULESET_NAME,
    target: "branch",
    enforcement: "active",
    bypass_actors: [{ actor_id: integrationId, actor_type: "Integration", bypass_mode: "always" }],
    conditions: {
      ref_name: {
        include: ["refs/heads/gh-pages"],
        exclude: []
      }
    },
    rules: [{ type: "update", parameters: { update_allows_fetch_and_merge: false } }]
  }
}

export function validateReleaseStateWriterRuleset(ruleset, appId) {
  const expected = releaseStateWriterRuleset(appId)
  if (!ruleset || ruleset.name !== expected.name || ruleset.target !== "branch" || ruleset.enforcement !== "active") {
    throw new Error("the active desktop release-state writer ruleset is missing")
  }
  if (!sameJson(ruleset.conditions, expected.conditions)) {
    throw new Error("the release-state writer ruleset must match only refs/heads/gh-pages")
  }
  if (!sameJson(ruleset.rules, expected.rules)) {
    throw new Error("the release-state writer ruleset must restrict branch updates")
  }
  if (!sameJson(ruleset.bypass_actors, expected.bypass_actors)) {
    throw new Error("only the configured release-state writer App may bypass the update rule")
  }
  return true
}

export function validateReleaseStateRulesetCollection(rulesets, appId) {
  if (!Array.isArray(rulesets)) throw new TypeError("repository rulesets must be an array")
  const matching = rulesets.filter(ruleset => ruleset?.name === RELEASE_STATE_RULESET_NAME)
  if (matching.length !== 1) throw new Error("exactly one desktop release-state writer ruleset must be active")
  return validateReleaseStateWriterRuleset(matching[0], appId)
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}
