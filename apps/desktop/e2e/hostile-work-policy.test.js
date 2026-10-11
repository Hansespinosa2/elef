import assert from "node:assert/strict"
import test from "node:test"
import { hostileWorkNeutralizedWorkflow } from "../../web/test/e2e/scenarios/hostile-work.js"

function host(externalMediaPolicy, state = {}) {
  return {
    externalMediaPolicy,
    async openWork() {},
    async showVisualMode() {},
    async waitForPreview() {},
    async inspectHostilePreview() {
      return {
        scriptRan: false,
        eventRan: false,
        frameRan: false,
        inlineHandlers: [],
        executableElements: [],
        unsafeLinks: [],
        unsafeMedia: [],
        externalMedia: [],
        remoteRequests: [],
        ...state
      }
    }
  }
}

test("the web host declares and permits its remote image source policy", async () => {
  await hostileWorkNeutralizedWorkflow(host("allow-remote", {
    externalMedia: ["https://example.invalid/tracker.png"]
  }))
  await hostileWorkNeutralizedWorkflow(host("allow-remote", {
    remoteRequests: ["https://example.invalid/tracker.png"]
  }))

  await assert.rejects(
    hostileWorkNeutralizedWorkflow(host("allow-remote")),
    /violated the allow-remote host policy/
  )
})

test("the native host rejects external media and remote requests", async () => {
  await hostileWorkNeutralizedWorkflow(host("reject-remote"))

  for (const state of [
    { externalMedia: ["https://example.invalid/tracker.png"] },
    { remoteRequests: ["https://example.invalid/tracker.png"] }
  ]) {
    await assert.rejects(
      hostileWorkNeutralizedWorkflow(host("reject-remote", state)),
      /violated the reject-remote host policy/
    )
  }
})

test("the hostile-work policy refuses an undeclared host policy", async () => {
  await assert.rejects(
    hostileWorkNeutralizedWorkflow(host(undefined)),
    /Host must declare an external media policy/
  )
})
