import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createLedger, parseLedger, reconcileMain, publishMacos, publishLinuxAsset } from "./ledger.mjs"
import { pagesStateFiles, readPagesLedger, writePagesStateFiles } from "./pages-state.mjs"

const SHA = "a".repeat(40)
const PR = 88
const NOW = "2026-10-09T18:00:00.000Z"

test("Pages writer derives state and safe feed together from the same ledger", async () => {
  let ledger = createLedger()
  ledger = reconcileMain(ledger, {
    mainHistory: [SHA],
    merges: [{ base: "main", merged: true, approved: true, pr: PR, sha: SHA, gate: "passed" }],
    expectedRevision: ledger.revision,
    now: () => NOW
  })
  const mac = {
    version: "0.1.0",
    source_sha: SHA,
    architecture: "aarch64",
    updater_url: "https://github.com/Hansespinosa2/elef/releases/download/desktop-v0.1.0/Elef.app.tar.gz",
    dmg_url: "https://github.com/Hansespinosa2/elef/releases/download/desktop-v0.1.0/Elef_0.1.0_aarch64.dmg",
    updater_sha256: "1".repeat(64),
    dmg_sha256: "2".repeat(64),
    signature: "verified-signature",
    signature_verified: true
  }
  const linux = {
    version: "0.1.0",
    source_sha: SHA,
    architecture: "x86_64",
    asset_url: "https://github.com/Hansespinosa2/elef/releases/download/desktop-v0.1.0/elef-desktop-v0.1.0-x86_64.tar.gz",
    sha256: "3".repeat(64),
    filename: "elef-desktop-v0.1.0-x86_64.tar.gz",
    format: "arch-native"
  }
  ledger = publishMacos(ledger, "0.1.0", mac, { expectedRevision: ledger.revision, at: NOW })
  ledger = publishLinuxAsset(ledger, "0.1.0", linux, { expectedRevision: ledger.revision, at: NOW })

  const files = pagesStateFiles(ledger)
  const state = parseLedger(files["desktop/stable/state.json"])
  const feed = JSON.parse(files["desktop/stable/latest.json"])
  assert.deepEqual(state, ledger)
  assert.equal(feed.version, "0.1.0")
  assert.equal(feed.pub_date, NOW)
  assert.deepEqual(Object.keys(feed.platforms), ["darwin-aarch64"])
  assert.deepEqual(feed.platforms["darwin-aarch64"], { signature: mac.signature, url: mac.updater_url })
  assert.equal(JSON.stringify(feed).includes("elef-desktop-v0.1.0-x86_64.tar.gz"), false)

  const root = await mkdtemp(path.join(os.tmpdir(), "elef-pages-state-"))
  try {
    assert.deepEqual(await writePagesStateFiles(root, ledger), [
      "desktop/stable/state.json",
      "desktop/stable/latest.json"
    ])
    assert.deepEqual(parseLedger(await readPagesLedger(root)), ledger)
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "desktop/stable/latest.json"), "utf8")), feed)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("when no safe macOS release exists, derived feed exposes no blocked or pending artifact", () => {
  const ledger = createLedger()
  const files = pagesStateFiles(ledger)
  const feed = JSON.parse(files["desktop/stable/latest.json"])
  assert.equal(feed.version, "0.0.0")
  assert.deepEqual(feed.platforms, {})
  assert.equal(JSON.stringify(feed).includes("signature"), false)
  assert.equal(JSON.stringify(feed).includes("url"), false)
})
