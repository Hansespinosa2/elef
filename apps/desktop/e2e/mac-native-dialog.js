import { execFileSync } from "node:child_process"

export function answerMacNativeDialog(button) {
  if (process.platform !== "darwin" || !["OK", "Cancel"].includes(button)) {
    throw new Error("Unsupported native macOS dialog action")
  }
  const executable = process.env.ELEF_E2E_REAL_APP_BINARY || process.env.ELEF_E2E_APP_BINARY
  if (!executable) throw new Error("The test application executable is missing")
  const pattern = "^" + executable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( |$)"
  const pids = execFileSync("pgrep", ["-f", pattern], { encoding: "utf8", timeout: 5_000 }).trim().split(/\s+/)
  if (pids.length !== 1 || !/^\d+$/.test(pids[0])) throw new Error("Expected exactly one installed test application process")
  // Panels may appear as a window or a sheet and can load asynchronously.
  // Target the test app's PID and the actual native button, not a timed keypress
  // to whichever process happens to be frontmost. Only direct window/sheet
  // buttons qualify; descendant webview buttons cannot answer a native panel.
  execFileSync("osascript", ["-e", `tell application "System Events"
    set targetProcess to first application process whose unix id is ${Number(pids[0])}
    repeat 200 times
      set frontmost of targetProcess to true
      repeat with targetWindow in every window of targetProcess
        try
          set uiItems to every button of targetWindow
          repeat with targetSheet in every sheet of targetWindow
            set uiItems to uiItems & every button of targetSheet
          end repeat
          repeat with uiItem in uiItems
            try
              if enabled of uiItem and name of uiItem is "${button}" then
                perform action "AXPress" of uiItem
                return "answered"
              end if
            end try
          end repeat
        end try
      end repeat
      delay 0.1
    end repeat
    error "The native ${button} button did not appear for the installed test application"
  end tell`], { timeout: 30_000 })
}
