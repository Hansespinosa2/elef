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

export function createIdleUpdateCheck(check, isBusy, {
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  let timer = null
  let due = false

  const runIfIdle = async () => {
    if (!due || isBusy()) return false

    due = false
    await check()
    return true
  }

  return {
    schedule(delayMs) {
      if (timer !== null) clearTimer(timer)
      timer = setTimer(() => {
        timer = null
        due = true
        void runIfIdle()
      }, delayMs)
    },
    resume: runIfIdle,
    cancel() {
      if (timer !== null) clearTimer(timer)
      timer = null
      due = false
    }
  }
}
