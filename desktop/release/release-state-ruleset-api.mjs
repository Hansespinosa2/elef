import { RELEASE_STATE_RULESET_NAME, validateReleaseStateRulesetCollection } from "./release-state-ruleset.mjs"

export async function verifyReleaseStateWriterPolicy({
  repository,
  appId,
  token,
  apiUrl = "https://api.github.com/",
  fetchImpl = globalThis.fetch
}) {
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new TypeError("release-state ruleset check needs an owner/repository name")
  }
  if (typeof token !== "string" || !token) throw new Error("release-state ruleset check needs repository read access")
  if (typeof fetchImpl !== "function") throw new TypeError("release-state ruleset check needs fetch")

  const baseUrl = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28"
  }
  const summaries = await requestJson(new URL(`repos/${repository}/rulesets?per_page=100&includes_parents=true`, baseUrl), headers, fetchImpl)
  if (!Array.isArray(summaries)) throw new Error("GitHub returned invalid release-state ruleset data")
  const matching = summaries.filter(item => item?.name === RELEASE_STATE_RULESET_NAME)
  if (matching.length !== 1) throw new Error("exactly one desktop release-state writer ruleset must be active")
  const summary = matching[0]
  if (summary.source_type !== "Repository" || summary.source?.toLowerCase() !== repository.toLowerCase()) {
    throw new Error("the release-state writer ruleset must belong to this repository")
  }
  if (!Number.isSafeInteger(summary.id) || summary.id < 1) throw new Error("GitHub returned an invalid release-state ruleset ID")

  const ruleset = await requestJson(new URL(`repos/${repository}/rulesets/${summary.id}?includes_parents=true`, baseUrl), headers, fetchImpl)
  validateReleaseStateRulesetCollection([ruleset], appId, repository)
  return { id: ruleset.id, name: ruleset.name }
}

async function requestJson(url, headers, fetchImpl) {
  let response
  try {
    response = await fetchImpl(url, { headers })
  } catch {
    throw new Error("could not confirm the active release-state branch ruleset")
  }
  if (!response.ok) throw new Error(`could not confirm the active release-state branch ruleset (HTTP ${response.status})`)
  try {
    return await response.json()
  } catch {
    throw new Error("GitHub returned invalid release-state ruleset data")
  }
}
