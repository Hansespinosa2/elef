import { readFile } from "node:fs/promises"
import path from "node:path"

import {
  assertBootstrapFailedGateRecorderRevision,
  isExactFailedMainReconcileDispatch,
  isExactFailedMainWorkflowRun,
  isExactMainReconciliationSchedule
} from "./coordinator-trust.mjs"
import { isRecordedFailedGate, parseLedger, pendingFailedGateNotifications, recordFailedGateMerge } from "./ledger.mjs"
import { publishPagesStateWithRetry } from "./pages-publisher.mjs"
import { writePagesStateFiles } from "./pages-state.mjs"

const STATE_FILE = "desktop/stable/state.json"
const SHA_PATTERN = /^[a-f0-9]{40}$/i

/**
 * Run the narrow failed-Gate-A bootstrap. GitHub verification and Pages CAS
 * are injected so the complete decision path can be exercised without secrets
 * or a live repository.
 */
export async function recordFailedGateBootstrap({
  pagesRoot,
  failureSha,
  coordinatorSha,
  ownerLogin,
  event,
  mainHistory,
  github,
  getCurrentMainSha,
  verifyWriterPolicy,
  publishPages = publishPagesStateWithRetry,
  readLedger = readPagesLedger,
  writeLedger = writePagesStateFiles,
  now = () => new Date().toISOString()
}) {
  if (!pagesRoot || !ownerLogin || !event || !github ||
      typeof getCurrentMainSha !== "function" || typeof verifyWriterPolicy !== "function") {
    throw new TypeError("failed-gate bootstrap needs Pages, GitHub, owner, and writer-policy dependencies")
  }
  if (!SHA_PATTERN.test(failureSha || "") || failureSha.toLowerCase() !== coordinatorSha?.toLowerCase()) {
    throw new Error("failure-only recording must target the exact workflow SHA")
  }

  const eventArguments = { ...event, mode: "current", coordinatorSha }
  const eligibleEvent = isExactFailedMainWorkflowRun(eventArguments) ||
    isExactFailedMainReconcileDispatch({ ...eventArguments, actor: event.actor, ownerLogin }) ||
    isExactMainReconciliationSchedule(eventArguments)
  if (!eligibleEvent) throw new Error("event is not eligible for exact-main failure-only recording")

  let resultRecord = null
  const publication = await publishPages({
    pagesRoot,
    reconcile: async ({ pagesRoot: activePagesRoot = pagesRoot } = {}) => {
      await verifyWriterPolicy()
      const currentMainSha = await getCurrentMainSha()
      if (currentMainSha?.toLowerCase() !== failureSha.toLowerCase()) {
        throw new Error("failed-gate bootstrap source is no longer the current main head")
      }

      const ledger = await readLedger(activePagesRoot)
      const verified = await assertBootstrapFailedGateRecorderRevision({
        coordinatorSha: failureSha,
        mainHistory,
        ledger,
        github,
        ownerLogin
      })
      const next = recordFailedGateMerge(ledger, {
        mainHistory,
        sha: failureSha,
        pr: verified.pr,
        expectedRevision: ledger.revision,
        at: now()
      })
      await writeLedger(activePagesRoot, next)
      resultRecord = { sha: failureSha, pr: verified.pr, revision: next.revision }
      return resultRecord
    }
  })

  const ledger = await readLedger(pagesRoot)
  const failureShaRecorded = isRecordedFailedGate(ledger, failureSha)
  if (!failureShaRecorded) throw new Error("the exact failed Gate A record was not preserved in the Pages ledger")

  return {
    publication,
    record: resultRecord,
    ledger,
    outputs: {
      macos_candidate: "",
      linux_candidate: "",
      aur_candidate: "",
      failure_only: "true",
      failure_sha: failureSha,
      failure_sha_recorded: "true",
      failed_notification_shas: pendingFailedGateNotifications(ledger),
      failed_gate_count: resultRecord ? 1 : 0,
      pending_sha: "",
      pending_reason: ""
    }
  }
}

async function readPagesLedger(pagesRoot) {
  return parseLedger(await readFile(path.join(pagesRoot, STATE_FILE), "utf8"))
}
