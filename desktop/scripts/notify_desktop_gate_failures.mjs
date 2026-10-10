import { appendFile } from "node:fs/promises"

import { ensureGateFailureIssue } from "../release/gate-failure-notifier.mjs"

const repository = requiredEnv("GITHUB_REPOSITORY")
const [ownerLogin] = repository.split("/")
const shas = parseShas(requiredEnv("DESKTOP_FAILED_GATE_NOTIFICATION_SHAS"))
const failureOnly = process.env.DESKTOP_RELEASE_FAILURE_ONLY === "true"
const failureSha = process.env.DESKTOP_RELEASE_FAILURE_SHA || ""
const failureShaRecorded = process.env.DESKTOP_RELEASE_FAILURE_SHA_RECORDED === "true"
const pendingSha = process.env.DESKTOP_RELEASE_PENDING_SHA || ""
const pendingReason = process.env.DESKTOP_RELEASE_PENDING_REASON || ""
if (failureOnly && !failureShaRecorded && /^[a-f0-9]{40}$/i.test(failureSha)) shas.push(failureSha)
const uniqueShas = [...new Set(shas)]
if (!uniqueShas.length) throw new Error("Gate A failure notification has no failed main SHAs")

const runUrl = `${requiredEnv("GITHUB_SERVER_URL")}/${repository}/actions/runs/${requiredEnv("GITHUB_RUN_ID")}`
const results = []
for (const sha of uniqueShas) {
  const isUnrecordedCurrentFailure = failureOnly && !failureShaRecorded && sha === failureSha
  const detail = isUnrecordedCurrentFailure
    ? pendingSha
      ? `The failure is not yet recorded in the Pages ledger because reconciliation is waiting at earlier SHA ${pendingSha} (${safePendingReason(pendingReason)}). No release candidate was emitted.`
      : "The failure is not yet recorded in the Pages ledger. No release candidate was emitted."
    : "The Pages ledger records this exact main merge as failed_gate. No release artifact is eligible."
  const result = await ensureGateFailureIssue({
    repository,
    ownerLogin,
    token: requiredEnv("GITHUB_TOKEN"),
    sha,
    runUrl,
    detail,
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com"
  })
  results.push({ sha, ...result })
}

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "## Owner-assigned Gate A alert issues",
    "",
    ...results.map(({ sha, url }) => `- \`${sha}\`: ${url}`)
  ].join("\n") + "\n")
}
process.stdout.write(`Confirmed ${results.length} owner-assigned Gate A alert issue(s).\n`)

function parseShas(value) {
  let shas
  try {
    shas = JSON.parse(value)
  } catch {
    throw new Error("failed-gate notification SHA list must be valid JSON")
  }
  if (!Array.isArray(shas) || shas.some(sha => typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha))) {
    throw new Error("failed-gate notification SHA list must contain commit SHAs")
  }
  return shas
}

function safePendingReason(reason) {
  const allowed = new Set([
    "pr_association_unavailable",
    "pr_record_unavailable",
    "gate_pending",
    "recovery_gate_pending",
    "unapproved_pr"
  ])
  return allowed.has(reason) ? reason : "pending_main_history"
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
