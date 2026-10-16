export const DEFAULT_LAUNCH_COUNT = 20

export function parseLaunchCount(args) {
  const flagIndex = args.indexOf("--launch-count")
  if (flagIndex === -1) return DEFAULT_LAUNCH_COUNT
  if (args.indexOf("--launch-count", flagIndex + 1) !== -1) {
    throw new Error("Provide --launch-count only once.")
  }

  const value = args[flagIndex + 1]
  if (!value || !/^\d+$/.test(value)) {
    throw new Error("--launch-count must be a positive safe integer.")
  }
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("--launch-count must be a positive safe integer.")
  }
  return count
}
