export async function checkForDesktopUpdate(check) {
  const update = await check()
  if (!update) return null
  return {
    version: update.version,
    notes: typeof update.body === "string" ? update.body : "",
    install: async onProgress => {
      await update.downloadAndInstall(event => onProgress?.(event))
    }
  }
}

export async function installDesktopUpdate(update, { onProgress, relaunch }) {
  if (!update || typeof update.install !== "function") {
    throw Object.assign(new TypeError("There is no verified update to install."), {
      code: "invalid_input",
      retryable: false
    })
  }
  await update.install(onProgress)
  await relaunch()
}
