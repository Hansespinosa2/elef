import test from "node:test"
import assert from "node:assert/strict"
import {
  blockVersions,
  createLedger,
  latestPendingPlatformRelease,
  parseLedger,
  publishAur,
  publishLinuxAsset,
  publishMacos,
  recordPlatformFailure,
  reconcileMain,
  safeMacosManifest,
  selectMinorMilestone,
  serializeLedger,
  unblockVersions
} from "./ledger.mjs"

const SHA1 = "a".repeat(40)
const SHA2 = "b".repeat(40)
const SHA3 = "c".repeat(40)
const NOW = "2026-10-09T12:00:00.000Z"

test("reconciliation reserves releases in first-parent main order and ignores duplicate events", () => {
  const start = createLedger()
  const merges = [merge(102, SHA2), merge(101, SHA1)]
  const first = reconcileMain(start, {
    mainHistory: [SHA1, SHA2],
    merges,
    expectedRevision: start.revision,
    now: fixedNow
  })

  assert.deepEqual(first.releases.map(release => [release.version, release.pr, release.main_sha]), [
    ["0.1.0", 101, SHA1],
    ["0.1.1", 102, SHA2]
  ])
  assert.equal(first.last_reconciled_main, SHA2)
  assert.equal(first.revision, 1)

  const replayed = reconcileMain(first, {
    mainHistory: [SHA1, SHA2],
    merges,
    expectedRevision: first.revision,
    now: fixedNow
  })
  assert.deepEqual(replayed, first)
})

test("failed Gate A merges are recorded without an artifact or version reservation", () => {
  const start = createLedger()
  const next = reconcileMain(start, {
    mainHistory: [SHA1, SHA2],
    merges: [merge(110, SHA1, "failed_gate"), merge(111, SHA2)],
    expectedRevision: start.revision,
    now: fixedNow
  })

  assert.equal(next.processed_merges[0].gate, "failed_gate")
  assert.equal(next.processed_merges[0].version, null)
  assert.equal(next.releases.length, 1)
  assert.equal(next.releases[0].version, "0.1.0")
})

test("a failed unpublished reservation remains a gap and is never reassigned", () => {
  let ledger = oneRelease()
  ledger = recordPlatformFailure(ledger, "0.1.0", "macos", {
    reason: "Hosted package build failed.",
    expectedRevision: ledger.revision,
    at: NOW
  })
  ledger = recordPlatformFailure(ledger, "0.1.0", "linux_asset", {
    reason: "Arch package validation failed.",
    expectedRevision: ledger.revision,
    at: NOW
  })
  ledger = reconcileMain(ledger, {
    mainHistory: [SHA1, SHA2],
    merges: [merge(101, SHA1), merge(102, SHA2)],
    expectedRevision: ledger.revision,
    now: fixedNow
  })

  assert.deepEqual(ledger.releases.map(release => release.version), ["0.1.0", "0.1.1"])
  assert.deepEqual(ledger.reserved_versions.map(item => item.version), ["0.1.0", "0.1.1"])
  assert.equal(ledger.releases[0].public, false)
})

test("partial delivery is public after one validated platform and the safe feed waits for macOS", () => {
  let ledger = oneRelease()
  const linux = linuxArtifact("0.1.0", SHA1)
  ledger = publishLinuxAsset(ledger, "0.1.0", linux, { expectedRevision: ledger.revision, at: NOW })
  assert.equal(ledger.releases[0].public, true)
  assert.equal(ledger.releases[0].macos.status, "pending")
  assert.equal(safeMacosManifest(ledger), null)

  const aur = aurArtifact("0.1.0", SHA1, linux.sha256)
  ledger = publishAur(ledger, "0.1.0", aur, { expectedRevision: ledger.revision, at: NOW })
  assert.equal(ledger.releases[0].aur.status, "passed")

  ledger = publishMacos(ledger, "0.1.0", macosArtifact("0.1.0", SHA1), { expectedRevision: ledger.revision, at: NOW })
  const manifest = safeMacosManifest(ledger)
  assert.equal(manifest.version, "0.1.0")
  assert.equal(manifest.pub_date, NOW)
  assert.deepEqual(Object.keys(manifest.platforms), ["darwin-aarch64"])
  assert.match(manifest.platforms["darwin-aarch64"].url, /desktop-v0\.1\.0/)
})

test("a failed platform can recover while the other platform publishes independently", () => {
  let ledger = oneRelease()
  ledger = recordPlatformFailure(ledger, "0.1.0", "macos", {
    reason: "ARM package build failed.",
    expectedRevision: ledger.revision,
    at: NOW
  })
  ledger = publishLinuxAsset(ledger, "0.1.0", linuxArtifact("0.1.0", SHA1), {
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.equal(ledger.releases[0].public, true)
  assert.equal(ledger.releases[0].macos.status, "failed")
  assert.equal(ledger.releases[0].linux_asset.status, "passed")
  assert.equal(safeMacosManifest(ledger), null)

  ledger = publishMacos(ledger, "0.1.0", macosArtifact("0.1.0", SHA1), {
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.equal(safeMacosManifest(ledger).version, "0.1.0")
})

test("newer validated platform artifacts supersede pending older deliveries and reject downgrades", () => {
  let ledger = twoReleases()
  ledger = publishLinuxAsset(ledger, "0.1.0", linuxArtifact("0.1.0", SHA1), {
    expectedRevision: ledger.revision,
    at: NOW
  })
  ledger = publishLinuxAsset(ledger, "0.1.1", linuxArtifact("0.1.1", SHA2), {
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.equal(ledger.releases[0].aur.status, "superseded")
  assert.equal(ledger.releases[0].aur.reason, "Superseded by published 0.1.1.")
  assert.throws(() => publishAur(ledger, "0.1.0", aurArtifact("0.1.0", SHA1, "1".repeat(64)), {
    expectedRevision: ledger.revision,
    at: NOW
  }), /superseded|newer 0\.1\.1/)

  ledger = publishMacos(ledger, "0.1.1", macosArtifact("0.1.1", SHA2), {
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.equal(ledger.releases[0].macos.status, "superseded")
  assert.equal(safeMacosManifest(ledger).version, "0.1.1")
  assert.throws(() => publishMacos(ledger, "0.1.0", macosArtifact("0.1.0", SHA1), {
    expectedRevision: ledger.revision,
    at: NOW
  }), /superseded|newer 0\.1\.1/)
})

test("platform catch-up selects the newest safe pending release and requires Linux publication for AUR", () => {
  const ledger = twoReleases()
  assert.equal(latestPendingPlatformRelease(ledger, "macos").version, "0.1.1")
  assert.equal(latestPendingPlatformRelease(ledger, "linux_asset").version, "0.1.1")
  assert.equal(latestPendingPlatformRelease(ledger, "aur"), null)

  const next = publishLinuxAsset(ledger, "0.1.1", linuxArtifact("0.1.1", SHA2), { expectedRevision: ledger.revision })
  assert.equal(latestPendingPlatformRelease(next, "aur").version, "0.1.1")
  assert.equal(next.releases.find(release => release.version === "0.1.0").linux_asset.status, "superseded")
})

test("invalid provenance, signature, checksum, and immutable retry metadata are rejected", () => {
  let ledger = oneRelease()
  assert.throws(() => publishMacos(ledger, "0.1.0", {
    ...macosArtifact("0.1.0", SHA1),
    signature_verified: false
  }, { expectedRevision: ledger.revision, at: NOW }), /signature must be verified/)
  assert.throws(() => publishLinuxAsset(ledger, "0.1.0", {
    ...linuxArtifact("0.1.0", SHA1),
    source_sha: SHA2
  }, { expectedRevision: ledger.revision, at: NOW }), /source SHA/)
  assert.throws(() => publishLinuxAsset(ledger, "0.1.0", {
    ...linuxArtifact("0.1.0", SHA1),
    sha256: "invalid"
  }, { expectedRevision: ledger.revision, at: NOW }), /SHA-256/)

  const verified = macosArtifact("0.1.0", SHA1)
  ledger = recordPlatformFailure(ledger, "0.1.0", "macos", {
    reason: "GitHub publication was interrupted.",
    artifact: verified,
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.throws(() => publishMacos(ledger, "0.1.0", {
    ...verified,
    updater_url: releaseUrl("0.1.0", "replacement.tar.gz")
  }, { expectedRevision: ledger.revision, at: NOW }), /changed its verified artifact/)
  ledger = publishMacos(ledger, "0.1.0", verified, { expectedRevision: ledger.revision, at: NOW })
  const versionBeforeRetry = ledger.revision
  ledger = publishMacos(ledger, "0.1.0", verified, { expectedRevision: versionBeforeRetry, at: NOW })
  assert.equal(ledger.revision, versionBeforeRetry, "an exact retry must be idempotent")
})

test("AUR metadata must checksum the exact Linux archive and later minor releases win the safe feed", () => {
  let ledger = oneRelease()
  ledger = publishLinuxAsset(ledger, "0.1.0", linuxArtifact("0.1.0", SHA1), {
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.throws(() => publishAur(ledger, "0.1.0", {
    ...aurArtifact("0.1.0", SHA1, "9".repeat(64)),
    package_name: "elef-desktop-bin"
  }, { expectedRevision: ledger.revision, at: NOW }), /checksum must match/)
  ledger = publishMacos(ledger, "0.1.0", macosArtifact("0.1.0", SHA1), {
    expectedRevision: ledger.revision,
    at: NOW
  })
  ledger = selectMinorMilestone(ledger, "0.2", {
    actor: "release-owner",
    reason: "Owner selected next minor series.",
    expectedRevision: ledger.revision,
    at: NOW
  })
  ledger = reconcileMain(ledger, {
    mainHistory: [SHA1, SHA3],
    merges: [merge(103, SHA3)],
    expectedRevision: ledger.revision,
    now: fixedNow
  })
  ledger = publishMacos(ledger, "0.2.0", macosArtifact("0.2.0", SHA3), {
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.equal(safeMacosManifest(ledger).version, "0.2.0")
})

test("blocking rejects stale publish writes and removes blocked versions from the derived feed", () => {
  let ledger = oneRelease()
  ledger = publishMacos(ledger, "0.1.0", macosArtifact("0.1.0", SHA1), {
    expectedRevision: ledger.revision,
    at: NOW
  })
  const linux = linuxArtifact("0.1.0", SHA1)
  ledger = publishLinuxAsset(ledger, "0.1.0", linux, { expectedRevision: ledger.revision, at: NOW })
  const staleRevision = ledger.revision
  ledger = blockVersions(ledger, ["0.1.0"], {
    actor: "release-owner",
    reason: "Unsafe update staging report.",
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.equal(ledger.releases[0].blocked, true)
  assert.equal(ledger.releases[0].blocked_by, "release-owner")
  assert.equal(safeMacosManifest(ledger), null)
  assert.throws(() => publishLinuxAsset(ledger, "0.1.0", linuxArtifact("0.1.0", SHA1), {
    expectedRevision: staleRevision,
    at: NOW
  }), /stale release state revision/)
  assert.throws(() => publishLinuxAsset(ledger, "0.1.0", linuxArtifact("0.1.0", SHA1), {
    expectedRevision: ledger.revision,
    at: NOW
  }), /blocked/)
  const aur = aurArtifact("0.1.0", SHA1, linux.sha256)
  assert.throws(() => publishAur(ledger, "0.1.0", aur, { expectedRevision: staleRevision, at: NOW }), /stale release state revision/)
  assert.throws(() => publishAur(ledger, "0.1.0", aur, { expectedRevision: ledger.revision, at: NOW }), /blocked/)

  ledger = unblockVersions(ledger, ["0.1.0"], {
    actor: "release-owner",
    reason: "Fixed release is now validated.",
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.equal(safeMacosManifest(ledger).version, "0.1.0")
  assert.deepEqual(ledger.releases[0].block_history.map(event => event.action), ["blocked", "unblocked"])
  const revisionAfterUnblock = ledger.revision
  ledger = unblockVersions(ledger, ["0.1.0"], {
    actor: "release-owner",
    reason: "Fixed release is now validated.",
    expectedRevision: ledger.revision,
    at: NOW
  })
  assert.equal(ledger.revision, revisionAfterUnblock, "replayed emergency actions must be idempotent")
})

test("manual minor milestones advance independently of PR labels and preexisting tags are never reused", () => {
  let ledger = createLedger()
  assert.throws(() => selectMinorMilestone(ledger, "0.2", {
    reason: "Set next release series.",
    expectedRevision: ledger.revision,
    at: NOW
  }), /authorized actor/)

  ledger = selectMinorMilestone(ledger, "0.2", {
    actor: "release-owner",
    reason: "Owner selected 0.2 milestone.",
    expectedRevision: ledger.revision,
    at: NOW
  })
  const sha = "d".repeat(40)
  ledger = reconcileMain(ledger, {
    mainHistory: [sha],
    merges: [merge(120, sha)],
    existingTags: ["desktop-v0.2.0"],
    expectedRevision: ledger.revision,
    now: fixedNow
  })
  assert.equal(ledger.releases[0].version, "0.2.1")
  assert.deepEqual(ledger.reserved_versions.slice(0, 2).map(item => [item.version, item.reason]), [
    ["0.2.0", "preexisting_tag"],
    ["0.2.1", "main_merge"]
  ])
})

test("release state serialization round-trips and rejects stale revision writes", () => {
  const ledger = oneRelease()
  const serialized = serializeLedger(ledger)
  assert.deepEqual(parseLedger(serialized), ledger)
  assert.throws(() => reconcileMain(ledger, {
    mainHistory: [SHA1],
    merges: [merge(101, SHA1)],
    expectedRevision: ledger.revision - 1,
    now: fixedNow
  }), /stale release state revision/)
})

function oneRelease() {
  const start = createLedger()
  return reconcileMain(start, {
    mainHistory: [SHA1],
    merges: [merge(101, SHA1)],
    expectedRevision: start.revision,
    now: fixedNow
  })
}

function twoReleases() {
  const start = createLedger()
  return reconcileMain(start, {
    mainHistory: [SHA1, SHA2],
    merges: [merge(101, SHA1), merge(102, SHA2)],
    expectedRevision: start.revision,
    now: fixedNow
  })
}

function merge(pr, sha, gate = "passed") {
  return { pr, sha, gate, base: "main", merged: true, approved: true }
}

function fixedNow() {
  return NOW
}

function releaseUrl(version, filename) {
  return `https://github.com/Hansespinosa2/elef/releases/download/desktop-v${version}/${filename}`
}

function linuxArtifact(version, sourceSha) {
  return {
    version,
    source_sha: sourceSha,
    filename: `elef-${version}-x86_64.tar.zst`,
    asset_url: releaseUrl(version, `elef-${version}-x86_64.tar.zst`),
    sha256: "1".repeat(64),
    architecture: "x86_64",
    format: "arch-native"
  }
}

function macosArtifact(version, sourceSha) {
  return {
    version,
    source_sha: sourceSha,
    architecture: "aarch64",
    updater_url: releaseUrl(version, `Elef_${version}_aarch64.app.tar.gz`),
    updater_sha256: "2".repeat(64),
    signature: "verified-minisign-signature",
    signature_verified: true,
    dmg_url: releaseUrl(version, `Elef_${version}_aarch64.dmg`),
    dmg_sha256: "3".repeat(64)
  }
}

function aurArtifact(version, sourceSha, assetSha256) {
  return {
    package_name: "elef-bin",
    version,
    pkgver: version,
    pkgrel: 1,
    source_sha: sourceSha,
    asset_sha256: assetSha256,
    pkgbuild_sha256: "4".repeat(64),
    srcinfo_sha256: "5".repeat(64)
  }
}
