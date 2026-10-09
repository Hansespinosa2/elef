import { execFileSync } from "node:child_process"

import {
  RELEASE_STATE_RULESET_NAME,
  releaseStateWriterRuleset,
  validateReleaseStateRulesetCollection
} from "../release/release-state-ruleset.mjs"

const [appId, mode] = process.argv.slice(2)
if (!appId || ![undefined, "--apply"].includes(mode)) {
  throw new Error("usage: node desktop/scripts/configure_release_state_ruleset.mjs <github-app-id> [--apply]")
}
const repository = process.env.GITHUB_REPOSITORY || "Hansespinosa2/elef"
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError("GITHUB_REPOSITORY must use owner/repository form")
const payload = releaseStateWriterRuleset(appId)
const existing = ghJson(["api", `repos/${repository}/rulesets?per_page=100`])
if (!Array.isArray(existing)) throw new TypeError("GitHub returned an invalid ruleset list")
const matches = existing.filter(rule => rule?.name === RELEASE_STATE_RULESET_NAME)
if (matches.length > 1) throw new Error(`multiple ${RELEASE_STATE_RULESET_NAME} rulesets exist`)
if (mode !== "--apply" && matches.length === 1) validateReleaseStateRulesetCollection(existing, appId)

if (mode === "--apply") {
  const method = matches.length ? "PUT" : "POST"
  const endpoint = matches.length
    ? `repos/${repository}/rulesets/${matches[0].id}`
    : `repos/${repository}/rulesets`
  ghJson(["api", "--method", method, endpoint, "--input", "-"], JSON.stringify(payload))
}

const current = ghJson(["api", `repos/${repository}/rulesets?per_page=100`])
validateReleaseStateRulesetCollection(current, appId)
const matching = current.find(rule => rule.name === RELEASE_STATE_RULESET_NAME)
process.stdout.write(`${mode === "--apply" ? "Configured" : "Verified"} ${RELEASE_STATE_RULESET_NAME} (${matching.id}) for refs/heads/gh-pages.\n`)

function ghJson(args, input) {
  try {
    const output = execFileSync("gh", args, {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 1024 * 1024
    })
    return JSON.parse(output)
  } catch {
    throw new Error("GitHub ruleset API request failed; check gh authentication and repository administration access")
  }
}
