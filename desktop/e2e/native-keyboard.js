import { execFileSync } from "node:child_process"

function desktopProcessId() {
  const pids = execFileSync("pgrep", ["-x", "elef-desktop"], { encoding: "utf8", timeout: 5_000 })
    .trim().split(/\s+/).filter(Boolean)
  if (pids.length !== 1 || !/^\d+$/.test(pids[0])) {
    throw new Error(`Expected one desktop application process, found ${pids.length}`)
  }
  return Number(pids[0])
}

export function focusDesktopWindow() {
  const pid = desktopProcessId()
  if (process.platform === "linux") {
    const windowIds = execFileSync("xdotool", ["search", "--sync", "--onlyvisible", "--pid", String(pid)], {
      encoding: "utf8", timeout: 5_000
    }).trim().split(/\s+/).filter(Boolean)
    if (!windowIds.length) throw new Error("The desktop application has no visible window")
    execFileSync("xdotool", ["windowactivate", "--sync", windowIds[0]], { timeout: 5_000 })
    return
  }
  if (process.platform === "darwin") {
    execFileSync("osascript", ["-e", `tell application "System Events"
      set frontmost of (first application process whose unix id is ${pid}) to true
    end tell`], { timeout: 5_000 })
    return
  }
  throw new Error(`Native window activation is unsupported on ${process.platform}`)
}

export function sendNativeKey(key, { activate = true } = {}) {
  const linuxKeys = {
    Escape: "Escape", Enter: "Return", ArrowRight: "Right", ArrowLeft: "Left", Home: "Home", End: "End"
  }
  const macKeyCodes = { Escape: 53, Enter: 36, ArrowRight: 124, ArrowLeft: 123, Home: 115, End: 119 }
  if (process.platform === "linux") {
    if (activate) focusDesktopWindow()
    const nativeKey = linuxKeys[key]
    if (!nativeKey) throw new Error(`Unsupported native key ${key}`)
    execFileSync("xdotool", ["key", "--clearmodifiers", nativeKey], { timeout: 5_000 })
    return
  }
  if (process.platform === "darwin") {
    if (activate) focusDesktopWindow()
    const keyCode = macKeyCodes[key]
    if (keyCode === undefined) throw new Error(`Unsupported native key ${key}`)
    execFileSync("osascript", ["-e", `tell application "System Events" to key code ${keyCode}`], { timeout: 5_000 })
    return
  }
  throw new Error(`Native keyboard input is unsupported on ${process.platform}`)
}

export function sendNativeText(text, { activate = true } = {}) {
  if (process.platform === "linux") {
    if (activate) focusDesktopWindow()
    execFileSync("xdotool", ["type", "--clearmodifiers", "--delay", "25", text], { timeout: 5_000 })
    return
  }
  if (process.platform === "darwin") {
    if (activate) focusDesktopWindow()
    const escaped = text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
    execFileSync("osascript", ["-e", `tell application "System Events" to keystroke "${escaped}"`], { timeout: 5_000 })
    return
  }
  throw new Error(`Native text input is unsupported on ${process.platform}`)
}
