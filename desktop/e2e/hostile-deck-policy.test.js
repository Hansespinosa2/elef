import assert from "node:assert/strict"
import test from "node:test"
import { hostileDeckNeutralizedWorkflow } from "../../test/e2e/scenarios/hostile-deck.js"

function host(externalMediaPolicy, state = {}) {
  return {
    externalMediaPolicy,
    async openDeck() {},
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
  await hostileDeckNeutralizedWorkflow(host("allow-remote", {
    externalMedia: ["https://example.invalid/tracker.png"]
  }))

  await assert.rejects(
    hostileDeckNeutralizedWorkflow(host("allow-remote")),
    /violated the allow-remote host policy/
  )
})

test("the native host rejects external media and remote requests", async () => {
  await hostileDeckNeutralizedWorkflow(host("reject-remote"))

  for (const state of [
    { externalMedia: ["https://example.invalid/tracker.png"] },
    { remoteRequests: ["https://example.invalid/tracker.png"] }
  ]) {
    await assert.rejects(
      hostileDeckNeutralizedWorkflow(host("reject-remote", state)),
      /violated the reject-remote host policy/
    )
  }
})

test("the hostile-deck policy refuses an undeclared host policy", async () => {
  await assert.rejects(
    hostileDeckNeutralizedWorkflow(host(undefined)),
    /Host must declare an external media policy/
  )
})
