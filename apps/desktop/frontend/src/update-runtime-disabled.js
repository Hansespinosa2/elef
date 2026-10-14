// Disabled update runtime: Linux and repository Dev resolve here, so those
// bundles never import the updater plugins and every update entry point
// reports the package-managed boundary (no check, no install, no seam, no
// arming). The updater boundary is enforcement-by-capability plus the native
// cfg gate; this runtime is the frontend side of the same boundary.
export function createDesktopUpdateRuntime() {
  return Object.freeze({
    enabled: false,
    checkForUpdate: async () => null,
    installPendingUpdate: async () => false,
    updaterSeam: null,
    armPendingUpdate() {},
    peekArmedUpdate() {
      return null
    },
    takeArmedUpdate() {
      return null
    },
    clearArmedUpdate() {}
  })
}
