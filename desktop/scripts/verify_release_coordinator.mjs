import { appendFile, readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"

import { GitHubReleaseApi } from "../release/github-api.mjs"
import { assertAuthorizedMainCoordinatorDispatch, assertAuthorizedReleaseTagDispatch, latestTrustedToolingSha, selectTrustedCoordinatorRevision, assertTrustedCoordinatorRevision } from "../release/coordinator-trust.mjs"
import { parseLedger } from "../release/ledger.mjs"

const [mode, mainCheckoutArgument, pagesCheckoutArgument] = process.argv.slice(2)
if (!["current", "latest"].includes(mode) || !mainCheckoutArgument || !pagesCheckoutArgument) {
  throw new Error("usage: node verify_release_coordinator.mjs <current|latest> <main-history-checkout> <gh-pages-checkout>")
}

const repository = requiredEnv("GITHUB_REPOSITORY")
const token = requiredEnv("GITHUB_TOKEN")
const [owner, repositoryName] = repository.split("/")
if (!owner || !repositoryName) throw new Error("GITHUB_REPOSITORY must use owner/repository form")

const mainCheckout = path.resolve(mainCheckoutArgument)
const pagesCheckout = path.resolve(pagesCheckoutArgument)
const mainHistory = git(mainCheckout, ["rev-list", "--first-parent", "--reverse", "origin/main"])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
if (!mainHistory.length) throw new Error("release tooling verification needs the current full main history")

const ledgerPath = path.join(pagesCheckout, "desktop/stable/state.json")
const ledger = parseLedger(await readFile(ledgerPath, "utf8"))
const github = new GitHubReleaseApi({
  owner,
  repository: repositoryName,
  token,
  apiUrl: process.env.GITHUB_API_URL || "https://api.github.com"
})
const repositoryInfo = await github.repositoryInfo()
const eventName = process.env.GITHUB_EVENT_NAME || ""
let dispatchTag = null
if (eventName === "workflow_dispatch" && mode === "latest") {
  dispatchTag = assertAuthorizedReleaseTagDispatch({
    actor: requiredEnv("GITHUB_ACTOR"),
    repositoryOwner: repositoryInfo.owner?.login,
    ref: requiredEnv("GITHUB_REF"),
    refType: requiredEnv("GITHUB_REF_TYPE"),
    refName: requiredEnv("GITHUB_REF_NAME"),
    sha: requiredEnv("GITHUB_SHA"),
    workflowSha: requiredEnv("DESKTOP_WORKFLOW_SHA"),
    ledger
  })
} else if (eventName === "workflow_dispatch" && mode === "current") {
  assertAuthorizedMainCoordinatorDispatch({
    actor: requiredEnv("GITHUB_ACTOR"),
    repositoryOwner: repositoryInfo.owner?.login,
    ref: requiredEnv("GITHUB_REF"),
    refType: requiredEnv("GITHUB_REF_TYPE"),
    refName: requiredEnv("GITHUB_REF_NAME"),
    sha: requiredEnv("GITHUB_SHA"),
    workflowSha: requiredEnv("DESKTOP_WORKFLOW_SHA")
  })
}
const coordinatorSha = mode === "current" ? requiredEnv("GITHUB_SHA") : latestTrustedToolingSha(ledger)
if (!coordinatorSha) throw new Error("release ledger contains no Gate-A-passed tooling revision")

const trustArguments = { coordinatorSha, mainHistory, ledger, github, ownerLogin: repositoryInfo.owner?.login }
let dispatchTooling
if (dispatchTag) {
  await assertTrustedCoordinatorRevision({ ...trustArguments, coordinatorSha: dispatchTag.main_sha })
  dispatchTooling = latestTrustedToolingSha(ledger)
  if (!dispatchTooling) throw new Error("manual actions need a Gate-A-passed tooling revision in the release ledger")
}
const trusted = mode === "current"
  ? dispatchTag
    ? await assertTrustedCoordinatorRevision({
        ...trustArguments,
        coordinatorSha: dispatchTooling
      })
    : await selectTrustedCoordinatorRevision(trustArguments)
  : await assertTrustedCoordinatorRevision(trustArguments)

const output = process.env.GITHUB_OUTPUT
if (output) {
  await appendFile(output, `trusted_tool_sha=${trusted.sha}\ntrusted_tool_pr=${trusted.pr}\n`)
}
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "## Trusted desktop release tooling",
    "",
    `- Tooling SHA: \`${trusted.sha}\``,
    `- Owner-approved main PR: #${trusted.pr}`,
    `- Exact-SHA Gate A: passed`,
    ...(trusted.selectedFrom === "ledger" ? [`- Event revision was not trusted; using the latest verified ledger tooling SHA.`] : []),
    "- Current `main` was checked out separately as reconciliation data."
  ].join("\n") + "\n")
}
process.stdout.write(`Trusted desktop release tooling: ${trusted.sha} (PR #${trusted.pr}; selected from ${trusted.selectedFrom || "ledger"}).\n`)

function git(repositoryPath, args) {
  try {
    return execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch {
    throw new Error(`could not inspect the current main history with Git ${args[0]}`)
  }
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
