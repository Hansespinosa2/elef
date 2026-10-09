import assert from "node:assert/strict"
import test from "node:test"
import { BUG_REPORT_RATE_LIMIT_MESSAGE, bugReportErrorMessage } from "../../app/javascript/lib/bug_report_response.js"

test("bug report rate limits show a clear wait message", () => {
  assert.equal(bugReportErrorMessage(429, { error: "server detail" }), BUG_REPORT_RATE_LIMIT_MESSAGE)
})

test("other bug report failures preserve server messages and use a fallback when absent", () => {
  assert.equal(bugReportErrorMessage(503, { error: "GitHub is unavailable." }), "GitHub is unavailable.")
  assert.match(bugReportErrorMessage(503, {}), /report is still here/)
})
