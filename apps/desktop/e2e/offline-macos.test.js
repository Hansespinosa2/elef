import assert from "node:assert/strict"
import test from "node:test"
import { offlineMacAppLauncherScript } from "./offline-macos.js"

test("the macOS offline launcher wraps the app binary in the sandbox profile", () => {
  const script = offlineMacAppLauncherScript("/tmp/elef identity/elef-desktop")
  assert.ok(script.startsWith("#!/bin/sh\nset -eu\n"), "the launcher must be a strict shell script")
  assert.ok(script.includes("/usr/bin/sandbox-exec -f "), "the launcher must exec through sandbox-exec")
  assert.ok(script.includes("offline-macos.sb"), "the launcher must pin the offline profile")
  assert.ok(script.includes("'/tmp/elef identity/elef-desktop'"), "the launcher must quote binary paths")
  assert.ok(script.includes('"$@"'), "the launcher must forward arguments")
  assert.ok(script.endsWith("\n"), "the launcher must end with a newline")
})
