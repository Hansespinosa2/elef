import assert from "node:assert/strict"
import test from "node:test"
import { offlineMacAppLauncherScript } from "./offline-macos.js"

test("offline app launcher embeds a shell-safe binary path and forwards app arguments", () => {
  const script = offlineMacAppLauncherScript("/tmp/Elef's test binary")

  assert.match(script, /^#!\/bin\/sh\nset -eu\n/)
  assert.match(script, /sandbox-exec -f '[^']*offline-macos\.sb' '\/tmp\/Elef'\\''s test binary' "\$@"$/m)
})
