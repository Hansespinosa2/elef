export async function checkForDesktopUpdate(check, install) {
  const update = await check()
  if (!update) return null
  return {
    version: update.version,
    notes: typeof update.body === "string" ? update.body : "",
    dispose: () => update.close(),
    install: async onProgress => {
      return await install(update.version, onProgress)
    }
  }
}

export async function installDesktopUpdate(update, { onProgress, relaunch, prepare = async () => true }) {
  if (!update || typeof update.install !== "function") {
    throw Object.assign(new TypeError("There is no verified update to install."), {
      code: "invalid_input",
      retryable: false
    })
  }
  if (!await prepare()) return false
  if (await update.install(onProgress) === false) return false
  await relaunch()
  return true
}
