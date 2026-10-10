export function createDesktopUpdateRuntime() {
  return Object.freeze({
    enabled: false,
    checkForUpdate: async () => null,
    installPendingUpdate: async () => false
  })
}
