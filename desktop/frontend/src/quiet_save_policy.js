// Desktop quiet-save policy: the timing values injected into the shared
// work-session factory. Changed text must reach disk within
// QUIET_SAVE_DISK_BUDGET_MS after the last edit (P02-02); the autosave delay
// stays below that budget and the watcher drain polls independently.
export const QUIET_SAVE_DISK_BUDGET_MS = 2500

export function createQuietSavePolicy(overrides = {}) {
  const policy = { saveDelay: 2000, externalPollMs: 1000, ...overrides }
  if (!Number.isFinite(policy.saveDelay) || policy.saveDelay <= 0) {
    throw new TypeError("Quiet-save policy requires a positive saveDelay.")
  }
  if (!Number.isFinite(policy.externalPollMs) || policy.externalPollMs <= 0) {
    throw new TypeError("Quiet-save policy requires a positive externalPollMs.")
  }
  return policy
}
