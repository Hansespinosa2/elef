import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { generateKeyPairSync } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("../../scripts/prepare-updater-config.mjs", import.meta.url))
const { publicKey } = generateKeyPairSync("ed25519")
const key = Buffer.concat([Buffer.from("Ed"), Buffer.alloc(8), publicKey.export({ type: "spki", format: "der" }).subarray(-32)])
const encodedKey = Buffer.from(`untrusted comment: ephemeral release-config test\n${key.toString("base64")}\n`).toString("base64")

test("release configuration binds the package version to the stable tag and requires signed versions", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "elef-release-config-"))
  const destination = path.join(folder, "release.json")
  try {
    execFileSync(process.execPath, [script, destination], {
      env: { ...process.env, DESKTOP_RELEASE_TAG: "desktop-v0.2.3", TAURI_UPDATER_PUBKEY: encodedKey },
      stdio: "pipe"
    })
    const config = JSON.parse(await readFile(destination, "utf8"))
    assert.equal(config.version, "0.2.3")
    assert.equal(config.bundle.createUpdaterArtifacts, true)
    assert.equal(config.plugins.updater.pubkey, encodedKey)
    assert.equal(config.plugins.updater.requireSignedVersion, true)
    assert.deepEqual(config.plugins.updater.endpoints, ["https://hansespinosa2.github.io/elef/desktop/stable/latest.json"])
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test("release configuration refuses invalid tags and unconfigured or malformed signing keys", () => {
  for (const overrides of [
    { DESKTOP_RELEASE_TAG: "feat/desktop-app-v1" },
    { DESKTOP_RELEASE_TAG: "desktop-v0.2.3-beta" },
    { TAURI_UPDATER_PUBKEY: "" },
    { TAURI_UPDATER_PUBKEY: "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY" },
    { TAURI_UPDATER_PUBKEY: "not a minisign public key" }
  ]) {
    assert.throws(() => execFileSync(process.execPath, [script, path.join(os.tmpdir(), "elef-must-not-write-release.json")], {
      env: { ...process.env, DESKTOP_RELEASE_TAG: "desktop-v0.2.3", TAURI_UPDATER_PUBKEY: encodedKey, ...overrides },
      stdio: "pipe"
    }), error => error.status === 1)
  }
})
