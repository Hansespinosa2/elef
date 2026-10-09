import assert from "node:assert/strict"
import test from "node:test"

import { archReleaseAssetUrl } from "./arch-package.mjs"
import { verifyPublishedLinuxArtifact } from "./aur-github.mjs"
import { assertAurCandidate, selectAurPackageName } from "./aur-publisher.mjs"
import { blockVersions, createLedger, publishLinuxAsset, reconcileMain } from "./ledger.mjs"

const MAIN_SHA = "a".repeat(40)
const ARCHIVE_SHA = "c".repeat(64)

test("AUR name registration never overwrites another maintainer and keeps the existing Elef package name", async () => {
  const requested = []
  const registry = new Map([
    ["elef-bin", { Name: "elef-bin", Maintainer: "unrelated-user" }],
    ["elef-desktop-bin", null]
  ])
  const fetchImpl = async url => {
    const name = new URL(url).searchParams.get("arg[]")
    requested.push(name)
    const result = registry.get(name)
    return {
      ok: true,
      async json() {
        return { version: 5, type: "multiinfo", resultcount: result ? 1 : 0, results: result ? [result] : [] }
      }
    }
  }
  const ledger = createLedger()
  assert.equal(await selectAurPackageName(ledger, { maintainer: "elef-owner", fetchImpl }), "elef-desktop-bin")
  assert.deepEqual(requested, ["elef-bin", "elef-desktop-bin"])

  const registered = {
    releases: [{
      version: "0.1.0",
      aur: { status: "passed", artifact: { package_name: "elef-bin" } }
    }]
  }
  registry.set("elef-bin", { Name: "elef-bin", Maintainer: "elef-owner" })
  requested.length = 0
  assert.equal(await selectAurPackageName(registered, { maintainer: "elef-owner", fetchImpl }), "elef-bin")
  assert.deepEqual(requested, ["elef-bin"])

  registry.set("elef-bin", { Name: "elef-bin", Maintainer: "another-user" })
  registry.set("elef-desktop-bin", { Name: "elef-desktop-bin", Maintainer: "another-user" })
  await assert.rejects(selectAurPackageName(ledger, { maintainer: "elef-owner", fetchImpl }), /both approved Elef AUR package names are occupied/)
})

test("AUR candidate selection requires newest public validated Linux release and rejects blocked or stale candidates", () => {
  let ledger = createLedger()
  ledger = reserve(ledger, 10, MAIN_SHA)
  ledger = publishLinuxAsset(ledger, "0.1.0", linuxArtifact("0.1.0", MAIN_SHA, ARCHIVE_SHA), { expectedRevision: ledger.revision })
  const candidate = { version: "0.1.0", tag: "desktop-v0.1.0", main_sha: MAIN_SHA, pr: 10 }
  assert.equal(assertAurCandidate(ledger, candidate).version, "0.1.0")

  const newerSha = "b".repeat(40)
  ledger = reserve(ledger, 11, newerSha)
  ledger = publishLinuxAsset(ledger, "0.1.1", linuxArtifact("0.1.1", newerSha, "d".repeat(64)), { expectedRevision: ledger.revision })
  assert.throws(() => assertAurCandidate(ledger, candidate), /no longer selects/)

  ledger = blockVersions(ledger, ["0.1.1"], {
    actor: "owner",
    reason: "Bad Linux artifact.",
    expectedRevision: ledger.revision
  })
  assert.throws(() => assertAurCandidate(ledger, {
    version: "0.1.1",
    tag: "desktop-v0.1.1",
    main_sha: newerSha,
    pr: 11
  }), /no longer selects/)
})

test("AUR promotion verifies the public archive digest, checksum sidecar, and source provenance", async () => {
  const ledger = await publicLedger()
  const candidate = { version: "0.1.0", tag: "desktop-v0.1.0", main_sha: MAIN_SHA, pr: 10 }
  const releaseRecord = assertAurCandidate(ledger, candidate)
  const publisher = {
    async request(resource) {
      assert.equal(resource, "/releases/tags/desktop-v0.1.0")
      return {
        tag_name: candidate.tag,
        draft: false,
        prerelease: false,
        assets: [
          remoteAsset("elef-0.1.0-x86_64.tar.zst", candidate.tag),
          remoteAsset("elef-0.1.0-x86_64.tar.zst.sha256", candidate.tag),
          remoteAsset("elef-0.1.0-x86_64.tar.zst.provenance.json", candidate.tag)
        ]
      }
    },
    async releaseAssetSha256(asset) {
      assert.equal(asset.name, "elef-0.1.0-x86_64.tar.zst")
      return ARCHIVE_SHA
    }
  }
  const fetchImpl = async url => {
    if (url.endsWith(".sha256")) return response(ARCHIVE_SHA + "  elef-0.1.0-x86_64.tar.zst\n")
    if (url.endsWith(".provenance.json")) return response(JSON.stringify({
      version: "0.1.0",
      main_sha: MAIN_SHA,
      sha256: ARCHIVE_SHA,
      platform: "linux",
      architecture: "x86_64",
      archive: "elef-0.1.0-x86_64.tar.zst"
    }))
    throw new Error("unexpected release asset URL")
  }

  const verified = await verifyPublishedLinuxArtifact({ publisher, candidate, releaseRecord, fetchImpl })
  assert.equal(verified.artifact.sha256, ARCHIVE_SHA)
  assert.equal(verified.archiveName, "elef-0.1.0-x86_64.tar.zst")
  await assert.rejects(verifyPublishedLinuxArtifact({
    publisher,
    candidate,
    releaseRecord,
    fetchImpl: async url => url.endsWith(".sha256")
      ? response("e".repeat(64) + "  elef-0.1.0-x86_64.tar.zst\n")
      : fetchImpl(url)
  }), /sidecar/)
})

async function publicLedger() {
  let ledger = createLedger()
  ledger = reserve(ledger, 10, MAIN_SHA)
  return publishLinuxAsset(ledger, "0.1.0", linuxArtifact("0.1.0", MAIN_SHA, ARCHIVE_SHA), { expectedRevision: ledger.revision })
}

function reserve(ledger, pr, sha) {
  return reconcileMain(ledger, {
    mainHistory: [sha],
    merges: [{ base: "main", merged: true, approved: true, pr, sha, gate: "passed" }],
    expectedRevision: ledger.revision,
    now: () => "2026-10-09T12:00:00.000Z"
  })
}

function linuxArtifact(version, sourceSha, sha256) {
  const filename = "elef-" + version + "-x86_64.tar.zst"
  return {
    version,
    source_sha: sourceSha,
    architecture: "x86_64",
    format: "arch-native",
    filename,
    asset_url: archReleaseAssetUrl(version),
    sha256
  }
}

function remoteAsset(name, tag) {
  return {
    name,
    state: "uploaded",
    browser_download_url: "https://github.com/Hansespinosa2/elef/releases/download/" + tag + "/" + name
  }
}

function response(body) {
  return {
    ok: true,
    url: "https://objects.githubusercontent.com/elef-release-asset",
    async arrayBuffer() {
      const bytes = Buffer.from(body)
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }
  }
}
