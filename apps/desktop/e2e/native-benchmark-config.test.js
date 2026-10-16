import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_LAUNCH_COUNT, parseLaunchCount } from "./native-benchmark-config.js"

test("native benchmark defaults to twenty launches and accepts a parameterized count", () => {
  assert.equal(parseLaunchCount([]), DEFAULT_LAUNCH_COUNT)
  assert.equal(parseLaunchCount(["--binary", "/tmp/elef", "--launch-count", "10"]), 10)
})

test("native benchmark rejects missing, repeated, zero, and unsafe launch counts", () => {
  for (const args of [
    ["--launch-count"],
    ["--launch-count", "0"],
    ["--launch-count", "2", "--launch-count", "3"],
    ["--launch-count", "9007199254740992"],
    ["--launch-count", "ten"]
  ]) {
    assert.throws(() => parseLaunchCount(args), /--launch-count|only once/)
  }
})
