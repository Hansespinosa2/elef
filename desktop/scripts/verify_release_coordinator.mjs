import { appendFile, readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"

import { GitHubReleaseApi } from "../release/github-api.mjs"
import { assertAuthorizedMainCoordinatorDispatch, assertAuthorizedReleaseTagDispatch, assertBootstrapFailedGateRecorderRevision, isExactFailedMainReconcileDispatch, isExactFailedMainWorkflowRun, isExactMainReconciliationSchedule, latestTrustedToolingSha, selectTrustedCoordinatorRevision, assertTrustedCoordinatorRevision } from "../release/coordinator-trust.mjs"
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
const failedWorkflowRun = isExactFailedMainWorkflowRun({
  mode,
  eventName,
  triggerEvent: process.env.DESKTOP_TRIGGER_EVENT,
  triggerBranch: process.env.DESKTOP_TRIGGER_BRANCH,
  triggerSha: process.env.DESKTOP_TRIGGER_SHA,
  gateConclusion: process.env.DESKTOP_GATE_CONCLUSION,
  ref: process.env.GITHUB_REF,
  refType: process.env.GITHUB_REF_TYPE,
  refName: process.env.GITHUB_REF_NAME,
  workflowSha: process.env.DESKTOP_WORKFLOW_SHA,
  coordinatorSha
})
const failedReconcileDispatch = isExactFailedMainReconcileDispatch({
  mode,
  eventName,
  action: process.env.DESKTOP_RELEASE_ACTION || "reconcile",
  actor: process.env.GITHUB_ACTOR,
  ownerLogin: repositoryInfo.owner?.login,
  ref: process.env.GITHUB_REF,
  refType: process.env.GITHUB_REF_TYPE,
  refName: process.env.GITHUB_REF_NAME,
  workflowSha: process.env.DESKTOP_WORKFLOW_SHA,
  coordinatorSha
})
const scheduledMainReconcile = isExactMainReconciliationSchedule({
  mode,
  eventName,
  ref: process.env.GITHUB_REF,
  refType: process.env.GITHUB_REF_TYPE,
  refName: process.env.GITHUB_REF_NAME,
  workflowSha: process.env.DESKTOP_WORKFLOW_SHA,
  coordinatorSha
})

let trusted
const bootstrapFailureOnly = (failedWorkflowRun || failedReconcileDispatch || scheduledMainReconcile) &&
  !latestTrustedToolingSha(ledger) &&
  await github.gateForMainSha(coordinatorSha) === "failed_gate"

if (bootstrapFailureOnly) {
  trusted = {
    ...(await assertBootstrapFailedGateRecorderRevision(trustArguments)),
    selectedFrom: "failure-only-bootstrap"
  }
} else {
  trusted = mode === "current"
    ? dispatchTag
      ? await assertTrustedCoordinatorRevision({
          ...trustArguments,
          coordinatorSha: dispatchTooling
        })
      : await selectTrustedCoordinatorRevision(trustArguments)
    : await assertTrustedCoordinatorRevision(trustArguments)
}
const failureOnly = trusted.selectedFrom === "failure-only-bootstrap"

const output = process.env.GITHUB_OUTPUT
if (output) {
  await appendFile(output, `trusted_tool_sha=${trusted.sha}\ntrusted_tool_pr=${trusted.pr}\nfailure_only=${failureOnly}\nfailure_sha=${failureOnly ? coordinatorSha : ""}\n`)
}
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    failureOnly ? "## Failure-only desktop release bootstrap" : "## Trusted desktop release tooling",
    "",
    `- Tooling SHA: \`${trusted.sha}\``,
    `- Owner-approved main PR: #${trusted.pr}`,
    failureOnly
      ? "- Exact-SHA Gate A: failed; tooling is permitted only to record the failure and suppress platform publication."
      : "- Exact-SHA Gate A: passed",
    ...(trusted.selectedFrom === "ledger" ? [`- Event revision was not trusted; using the latest verified ledger tooling SHA.`] : []),
    "- Current `main` was checked out separately as reconciliation data."
  ].join("\n") + "\n")
}
process.stdout.write(`${failureOnly ? "Failure-only desktop release bootstrap" : "Trusted desktop release tooling"}: ${trusted.sha} (PR #${trusted.pr}; selected from ${trusted.selectedFrom || "ledger"}).\n`)

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
