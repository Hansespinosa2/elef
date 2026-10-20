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

// Client settings affordance seam: reports update availability without
// owning installation (host menus and the idle flow keep that). Each query
// releases its native update resource right away; a later install re-checks
// through the owning flow, so dropping the handle here is safe.
export function createDesktopUpdaterSeam({ check }) {
  if (typeof check !== "function") throw new TypeError("An updater check function is required.")
  async function query() {
    const update = await check()
    if (!update) return { available: false }
    const version = typeof update.version === "string" ? update.version : undefined
    try {
      // The adapted check shape releases via dispose; the raw plugin update
      // releases via close. Either way the seam drops its handle right away.
      if (typeof update.dispose === "function") await update.dispose()
      else if (typeof update.close === "function") await update.close()
    } catch (_error) {
      // Availability is already recorded; releasing the native resource is best-effort.
    }
    return version === undefined ? { available: true } : { available: true, version }
  }
  return { status: query, checkForUpdate: query }
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
