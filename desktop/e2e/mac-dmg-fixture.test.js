import assert from "node:assert/strict"
import test from "node:test"
import { verifyMacArm64Executable } from "./install-macos-dmg-fixture.js"

test("Mac DMG fixture verifies arm64 with lipo's input-first argument order", () => {
  let invocation
  verifyMacArm64Executable("/tmp/Elef.app/Contents/MacOS/elef-desktop", (...args) => {
    invocation = args
  })
  assert.deepEqual(invocation, [
    "lipo",
    ["/tmp/Elef.app/Contents/MacOS/elef-desktop", "-verify_arch", "arm64"],
    { stdio: "inherit" }
  ])
})
