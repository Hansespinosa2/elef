export const BUG_REPORT_RATE_LIMIT_MESSAGE = "Too many bug reports were submitted. Wait a few minutes and try again."

export function bugReportErrorMessage(status, result) {
  if (status === 429) return BUG_REPORT_RATE_LIMIT_MESSAGE
  return result.error || "The issue could not be created. Your report is still here; please try again."
}
