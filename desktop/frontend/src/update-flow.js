export async function checkForDesktopUpdate(stage) {
  const update = await stage()
  if (!update) return null
  if (typeof update.version !== "string" || update.version.length === 0) {
    throw Object.assign(new TypeError("The staged update has no version."), {
      code: "invalid_input",
      retryable: false
    })
  }
  return {
    version: update.version,
    notes: typeof update.notes === "string" ? update.notes : ""
  }
}

export async function installDesktopUpdate(update, { install, relaunch }) {
  if (!update || typeof update.version !== "string" || typeof install !== "function") {
    throw Object.assign(new TypeError("There is no verified update to install."), {
      code: "invalid_input",
      retryable: false
    })
  }
  if (await install(update.version) === false) return false
  await relaunch()
  return true
}

export function createIdleUpdateCheck(check, isBusy, {
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  repeatDelayMs = 0
} = {}) {
  let timer = null
  let due = false
  let cancelled = false
  let running = false

  const schedule = delayMs => {
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      due = true
      void runIfIdle()
    }, delayMs)
  }

  const runIfIdle = async () => {
    if (!due || isBusy() || running) return false

    due = false
    running = true
    try {
      await check()
    } finally {
      running = false
      if (!cancelled && repeatDelayMs > 0) schedule(repeatDelayMs)
    }
    return true
  }

  return {
    schedule(delayMs) {
      cancelled = false
      due = false
      schedule(delayMs)
    },
    resume: runIfIdle,
    cancel() {
      if (timer !== null) clearTimer(timer)
      timer = null
      due = false
      cancelled = true
    }
  }
}
