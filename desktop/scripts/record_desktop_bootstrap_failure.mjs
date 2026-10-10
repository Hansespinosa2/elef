import { appendFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"

import { GitHubReleaseApi } from "../release/github-api.mjs"
import { recordFailedGateBootstrap } from "../release/failed-gate-bootstrap.mjs"
import { verifyReleaseStateWriterPolicy } from "../release/release-state-ruleset-api.mjs"

const [pagesRootArgument, sourceRootArgument] = process.argv.slice(2)
if (!pagesRootArgument || !sourceRootArgument) {
  throw new Error("usage: node record_desktop_bootstrap_failure.mjs <gh-pages-checkout> <exact-failed-main-checkout>")
}
if (requiredEnv("DESKTOP_RELEASE_FAILURE_ONLY") !== "true") {
  throw new Error("the narrow failed-gate recorder requires failure-only coordinator authorization")
}

const pagesRoot = path.resolve(pagesRootArgument)
const sourceRoot = path.resolve(sourceRootArgument)
const failureSha = requiredEnv("DESKTOP_RELEASE_FAILURE_SHA")
const coordinatorSha = requiredEnv("GITHUB_SHA")
if (!/^[a-f0-9]{40}$/i.test(failureSha) || failureSha !== coordinatorSha) {
  throw new Error("failure-only recording must target the exact workflow SHA")
}
if (git(sourceRoot, ["rev-parse", "HEAD"]).trim() !== failureSha) {
  throw new Error("failure-only source checkout does not match the verified failed SHA")
}

const repository = requiredEnv("GITHUB_REPOSITORY")
const token = requiredEnv("GITHUB_TOKEN")
const [owner, repositoryName] = repository.split("/")
if (!owner || !repositoryName) throw new Error("GITHUB_REPOSITORY must use owner/repository form")
const api = new GitHubReleaseApi({
  owner,
  repository: repositoryName,
  token,
  apiUrl: process.env.GITHUB_API_URL || "https://api.github.com"
})
const repositoryInfo = await api.repositoryInfo()
const mainHistory = git(sourceRoot, ["rev-list", "--first-parent", "--reverse", failureSha])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)

const result = await recordFailedGateBootstrap({
  pagesRoot,
  failureSha,
  coordinatorSha,
  ownerLogin: repositoryInfo.owner?.login,
  event: {
    eventName: process.env.GITHUB_EVENT_NAME || "",
    ref: process.env.GITHUB_REF,
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    workflowSha: process.env.DESKTOP_WORKFLOW_SHA,
    triggerEvent: process.env.DESKTOP_TRIGGER_EVENT,
    triggerBranch: process.env.DESKTOP_TRIGGER_BRANCH,
    triggerSha: process.env.DESKTOP_TRIGGER_SHA,
    gateConclusion: process.env.DESKTOP_GATE_CONCLUSION,
    action: process.env.DESKTOP_RELEASE_ACTION || "reconcile",
    actor: process.env.GITHUB_ACTOR
  },
  mainHistory,
  github: api,
  getCurrentMainSha: async () => (await api.request("/git/ref/heads/main"))?.object?.sha,
  verifyWriterPolicy: () => verifyReleaseStateWriterPolicy({
    repository,
    appId: requiredEnv("ELEF_RELEASE_STATE_APP_ID"),
    token: requiredEnv("ELEF_RELEASE_STATE_PUSH_TOKEN"),
    expectedUpdatedAt: requiredEnv("ELEF_RELEASE_STATE_RULESET_UPDATED_AT"),
    apiUrl: process.env.GITHUB_API_URL
  })
})

await writeOutputs(result.outputs)
await writeSummary({
  outputs: result.outputs,
  pr: result.record?.pr,
  revision: result.ledger.revision,
  published: result.publication.published,
  commitSha: result.publication.commitSha
})
process.stdout.write(`Recorded only failed Gate A for ${failureSha}; no release candidates were created; Pages ledger revision ${result.ledger.revision}.\n`)

function git(repositoryPath, args) {
  try {
    return execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch {
    throw new Error(`could not inspect failure-only source with Git ${args[0]}`)
  }
}

async function writeOutputs(values) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  await appendFile(output, [
    `macos_candidate=${values.macos_candidate}`,
    `linux_candidate=${values.linux_candidate}`,
    `aur_candidate=${values.aur_candidate}`,
    `failure_only=${values.failure_only}`,
    `failure_sha=${values.failure_sha}`,
    `failure_sha_recorded=${values.failure_sha_recorded}`,
    `failed_notification_shas=${JSON.stringify(values.failed_notification_shas)}`,
    `failed_gate_count=${values.failed_gate_count}`,
    `pending_sha=${values.pending_sha}`,
    `pending_reason=${values.pending_reason}`
  ].join("\n") + "\n")
}

async function writeSummary({ outputs: values, pr, revision, published, commitSha }) {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  await appendFile(summary, [
    "## Failure-only desktop release bootstrap",
    "",
    `- Exact failed main SHA: \`${values.failure_sha}\``,
    `- Owner-approved PR: #${pr}`,
    `- Failed gate record: ${values.failure_sha_recorded ? "present" : "missing"}`,
    `- Ledger revision: \`${revision}\``,
    `- Main watermark unchanged: yes`,
    `- Version reservations and release candidates: none`,
    `- Pages commit: ${published ? `\`${commitSha}\`` : "unchanged"}`
  ].join("\n") + "\n")
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
