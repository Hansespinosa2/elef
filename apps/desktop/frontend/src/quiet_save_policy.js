// Desktop quiet-save policy: the timing values injected into the shared
// work-session factory. Changed text must reach disk within
// QUIET_SAVE_DISK_BUDGET_MS after the last edit (P02-02); the autosave delay
// stays below that budget and the watcher drain polls independently.
// Changed-editing decks also take a periodic safety snapshot every
// SNAPSHOT_INTERVAL (P02-08); web sessions omit it and stay untouched.
export const QUIET_SAVE_DISK_BUDGET_MS = 2500
export const QUIET_SAVE_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

export function createQuietSavePolicy(overrides = {}) {
  const policy = { saveDelay: 2000, externalPollMs: 1000, snapshotIntervalMs: QUIET_SAVE_SNAPSHOT_INTERVAL_MS, ...overrides }
  if (!Number.isFinite(policy.saveDelay) || policy.saveDelay <= 0) {
    throw new TypeError("Quiet-save policy requires a positive saveDelay.")
  }
  if (!Number.isFinite(policy.externalPollMs) || policy.externalPollMs <= 0) {
    throw new TypeError("Quiet-save policy requires a positive externalPollMs.")
  }
  if (!Number.isFinite(policy.snapshotIntervalMs) || policy.snapshotIntervalMs <= 0) {
    throw new TypeError("Quiet-save policy requires a positive snapshotIntervalMs.")
  }
  return policy
}
