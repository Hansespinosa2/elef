import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, rm, symlink as createSymlink, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { spawnSync } from "node:child_process"

import {
  ARCH_PACKAGE_DEPENDENCIES,
  ARCH_PACKAGE_NAME,
  archReleaseAssetUrl,
  packageArchArchive,
  renderArchPkgbuild
} from "./arch-package.mjs"
import { buildMacosArtifactMetadata } from "../scripts/prepare_macos_release_assets.mjs"
import { buildLinuxArtifactMetadata } from "../scripts/prepare_linux_release_assets.mjs"
import { synchronizeAurCheckout, validateAurSrcInfo } from "./aur-publisher.mjs"

const version = "0.1.0"
const sha256 = "a".repeat(64)
const mainSha = "b".repeat(40)

test("AUR PKGBUILD pins the exact immutable asset checksum and runtime dependencies", async () => {
  const pkgbuild = await renderArchPkgbuild({ version, sha256 })
  assert.match(pkgbuild, new RegExp(`pkgname=${ARCH_PACKAGE_NAME}`))
  assert.match(pkgbuild, new RegExp(`pkgver=${version.replaceAll(".", "\\.")}`))
  assert.match(pkgbuild, new RegExp(archReleaseAssetUrl(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.match(pkgbuild, new RegExp(`sha256sums=\\('${sha256}'\\)`))
  for (const dependency of ARCH_PACKAGE_DEPENDENCIES) assert.match(pkgbuild, new RegExp(`'${dependency}'`))
  assert.match(pkgbuild, /makedepends=\('zstd'\)/)
  assert.match(pkgbuild, /tar --zstd -xf/)
  assert.doesNotMatch(pkgbuild, /AppImage|appimage/i)
  const fallback = await renderArchPkgbuild({ version, sha256, packageName: "elef-desktop-bin" })
  assert.match(fallback, /^pkgname=elef-desktop-bin$/m)
  assert.match(fallback, /^install=elef-desktop-bin\.install$/m)
  await assert.rejects(renderArchPkgbuild({ version, sha256, packageName: "unrelated-bin" }))
})

test("only a loopback test server may replace the immutable release URL", async () => {
  const localSource = `http://127.0.0.1:8123/elef-${version}-x86_64.tar.zst`
  const pkgbuild = await renderArchPkgbuild({ version, sha256, sourceUrl: localSource, allowLoopback: true })
  assert.ok(pkgbuild.includes(localSource))
  await assert.rejects(renderArchPkgbuild({ version, sha256, sourceUrl: "http://example.com/elef.tar.zst", allowLoopback: true }))
  await assert.rejects(renderArchPkgbuild({ version, sha256, sourceUrl: localSource }))
  await assert.rejects(renderArchPkgbuild({ version: "0.1.0-rc1", sha256 }))
  await assert.rejects(renderArchPkgbuild({ version, sha256: "bad" }))
})

test("native archive has deterministic Arch paths, mode, hash, and source provenance", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-arch-package-test-"))
  try {
    const binaryPath = path.join(temporaryRoot, "elef-desktop")
    const outputDirectory = path.join(temporaryRoot, "out")
    await writeFile(binaryPath, "test executable")
    await chmod(binaryPath, 0o755)
    const result = await packageArchArchive({ version, binaryPath, outputDirectory, buildSha: mainSha })
    const repeat = await packageArchArchive({ version, binaryPath, outputDirectory: path.join(temporaryRoot, "repeat"), buildSha: mainSha })
    assert.equal(result.archiveName, `elef-${version}-x86_64.tar.zst`)
    assert.equal(repeat.sha256, result.sha256, "the same Arch package inputs must produce the same archive bytes")
    const archiveList = spawnSync("tar", ["--zstd", "-tf", result.archivePath], { encoding: "utf8" })
    assert.equal(archiveList.status, 0, archiveList.stderr)
    for (const archivePath of [
      "usr/bin/elef",
      "usr/share/applications/elef.desktop",
      "usr/share/icons/hicolor/512x512/apps/elef.png",
      "usr/share/mime/packages/elef.xml",
      "usr/share/licenses/elef-bin/LICENSE",
      "usr/share/elef/version.json"
    ]) assert.ok(archiveList.stdout.split("\n").includes(archivePath), `${archivePath} is missing from the archive`)
    assert.doesNotMatch(archiveList.stdout, /AppImage/)

    const archivedBinary = spawnSync("tar", ["--zstd", "-xOf", result.archivePath, "usr/bin/elef"], { encoding: "utf8" })
    assert.equal(archivedBinary.status, 0)
    assert.equal(archivedBinary.stdout, "test executable")
    const buildInfo = JSON.parse(spawnSync("tar", ["--zstd", "-xOf", result.archivePath, "usr/share/elef/version.json"], { encoding: "utf8" }).stdout)
    assert.deepEqual(buildInfo, { version, build_sha: mainSha, profile: "stable", platform: "linux", architecture: "x86_64" })

    const bytes = await readFile(result.archivePath)
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"))
    assert.equal(await readFile(`${result.archivePath}.sha256`, "utf8"), `${result.sha256}  ${result.archiveName}\n`)
    const provenance = JSON.parse(await readFile(`${result.archivePath}.provenance.json`, "utf8"))
    assert.deepEqual(provenance, {
      schema_version: 1,
      version,
      main_sha: mainSha,
      platform: "linux",
      architecture: "x86_64",
      archive: result.archiveName,
      sha256: result.sha256
    })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("Arch package builder rejects non-executable and symlink inputs", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-arch-package-invalid-"))
  try {
    const binaryPath = path.join(temporaryRoot, "not-executable")
    await writeFile(binaryPath, "contents")
    await assert.rejects(packageArchArchive({ version, binaryPath, outputDirectory: path.join(temporaryRoot, "out"), buildSha: mainSha }))
    const symlink = path.join(temporaryRoot, "linked-binary")
    await createSymlink(binaryPath, symlink)
    await chmod(binaryPath, 0o755)
    await assert.rejects(packageArchArchive({ version, binaryPath: symlink, outputDirectory: path.join(temporaryRoot, "out"), buildSha: mainSha }))
    await assert.rejects(packageArchArchive({ version, binaryPath, outputDirectory: path.join(temporaryRoot, "out"), buildSha: "not-a-commit" }))
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("Linux release config embeds the reserved version without enabling updater artifacts", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-linux-release-config-"))
  try {
    const outputPath = path.join(temporaryRoot, "release.conf.json")
    const result = spawnSync(process.execPath, [
      "desktop/scripts/prepare-linux-release-config.mjs",
      outputPath
    ], {
      encoding: "utf8",
      env: { ...process.env, DESKTOP_RELEASE_VERSION: version }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), {
      version,
      bundle: { createUpdaterArtifacts: false }
    })

    const invalid = spawnSync(process.execPath, ["desktop/scripts/prepare-linux-release-config.mjs", outputPath], {
      encoding: "utf8",
      env: { ...process.env, DESKTOP_RELEASE_VERSION: "0.1.0-rc1" }
    })
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stderr, /numeric semantic version/)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("macOS release metadata binds signed updater, signature, DMG, source, and version", () => {
  const updaterBundle = { name: "Elef.app.tar.gz", path: "/tmp/Elef.app.tar.gz", sha256: "1".repeat(64) }
  const updaterSignature = { name: "Elef.app.tar.gz.sig", path: "/tmp/Elef.app.tar.gz.sig", sha256: "2".repeat(64) }
  const dmg = { name: "Elef_0.1.0_aarch64.dmg", path: "/tmp/Elef.dmg", sha256: "3".repeat(64) }
  const metadata = buildMacosArtifactMetadata({
    version,
    sourceSha: mainSha,
    pr: 147,
    updaterBundle,
    updaterSignature,
    dmg,
    signature: "base64-tauri-signature"
  })
  assert.equal(metadata.artifact.signature_verified, true)
  assert.equal(metadata.artifact.source_sha, mainSha)
  assert.equal(metadata.artifact.updater_url, `https://github.com/Hansespinosa2/elef/releases/download/desktop-v${version}/${updaterBundle.name}`)
  assert.equal(metadata.artifact.dmg_url, `https://github.com/Hansespinosa2/elef/releases/download/desktop-v${version}/${dmg.name}`)
  assert.deepEqual(metadata.files.map(file => file.name), [updaterBundle.name, updaterSignature.name, dmg.name])
  assert.throws(() => buildMacosArtifactMetadata({
    version,
    sourceSha: mainSha,
    pr: 147,
    updaterBundle,
    updaterSignature: { ...updaterSignature, name: "wrong.sig" },
    dmg,
    signature: "base64"
  }), /must be paired/)
})

test("Linux release metadata requires exact archive checksum, version, source, and provenance", () => {
  const filename = `elef-${version}-x86_64.tar.zst`
  const sha = "c".repeat(64)
  const provenance = {
    schema_version: 1,
    version,
    main_sha: mainSha,
    platform: "linux",
    architecture: "x86_64",
    archive: filename,
    sha256: sha
  }
  const metadata = buildLinuxArtifactMetadata({
    version,
    sourceSha: mainSha,
    pr: 147,
    archive: { name: filename, path: "/tmp/archive" },
    checksumFile: { name: `${filename}.sha256`, path: "/tmp/archive.sha256" },
    provenanceFile: { name: `${filename}.provenance.json`, path: "/tmp/archive.provenance.json" },
    checksum: sha,
    provenance
  })
  assert.equal(metadata.artifact.format, "arch-native")
  assert.equal(metadata.artifact.sha256, sha)
  assert.equal(metadata.artifact.asset_url, archReleaseAssetUrl(version))
  assert.throws(() => buildLinuxArtifactMetadata({
    version,
    sourceSha: mainSha,
    pr: 147,
    archive: { name: filename, path: "/tmp/archive" },
    checksumFile: { name: `${filename}.sha256`, path: "/tmp/archive.sha256" },
    provenanceFile: { name: `${filename}.provenance.json`, path: "/tmp/archive.provenance.json" },
    checksum: "d".repeat(64),
    provenance
  }), /does not match its provenance/)
})

test("AUR .SRCINFO pins the immutable release URL, archive checksum, package name, and version", () => {
  const checksum = "d".repeat(64)
  assert.equal(validateAurSrcInfo(srcinfo(version, 1, checksum), {
    version,
    pkgrel: 1,
    filename: "elef-" + version + "-x86_64.tar.zst",
    asset_url: archReleaseAssetUrl(version),
    asset_sha256: checksum
  }), true)
  assert.throws(() => validateAurSrcInfo(srcinfo(version, 1, "e".repeat(64)), {
    version,
    pkgrel: 1,
    filename: "elef-" + version + "-x86_64.tar.zst",
    asset_url: archReleaseAssetUrl(version),
    asset_sha256: checksum
  }), /checksum/)
})

test("AUR synchronization fast-forwards, rechecks before push, and retries exact metadata idempotently", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-aur-sync-test-"))
  const remotePath = path.join(temporaryRoot, "aur.git")
  const checkoutPath = path.join(temporaryRoot, "checkout")
  const oldVersion = "0.1.0"
  const oldFiles = aurPackageFiles(oldVersion, 1, "a".repeat(64))
  const newFiles = aurPackageFiles("0.1.1", 1, "b".repeat(64))
  try {
    const initialized = spawnSync("git", ["init", "--bare", "--initial-branch=master", remotePath], { encoding: "utf8" })
    assert.equal(initialized.status, 0, initialized.stderr)
    const cloned = spawnSync("git", ["clone", remotePath, checkoutPath], { encoding: "utf8" })
    assert.equal(cloned.status, 0, cloned.stderr)
    await configureGitIdentity(checkoutPath)
    await writeAurFiles(checkoutPath, oldFiles)
    await gitCommand(checkoutPath, ["add", "PKGBUILD", ".SRCINFO", "elef-bin.install"])
    await gitCommand(checkoutPath, ["commit", "-m", "Initial AUR package"])
    await gitCommand(checkoutPath, ["push", "origin", "HEAD:master"])

    let eligibilityChecks = 0
    const beforePush = async () => { eligibilityChecks += 1 }
    const result = await synchronizeAurCheckout({
      checkoutPath,
      files: newFiles,
      version: "0.1.1",
      pkgrel: 1,
      beforePush
    })
    assert.equal(result.changed, true)
    assert.match(result.commit, /^[a-f\d]{40}$/)
    assert.equal(eligibilityChecks, 1)
    assert.equal(await readFile(path.join(checkoutPath, ".SRCINFO"), "utf8"), newFiles[".SRCINFO"])

    const retry = await synchronizeAurCheckout({
      checkoutPath,
      files: newFiles,
      version: "0.1.1",
      pkgrel: 1,
      beforePush: async () => { eligibilityChecks += 1 }
    })
    assert.equal(retry.changed, false)
    assert.equal(retry.commit, result.commit)
    assert.equal(eligibilityChecks, 1, "an exact already-published retry needs no redundant push")
    await assert.rejects(synchronizeAurCheckout({
      checkoutPath,
      files: oldFiles,
      version: oldVersion,
      pkgrel: 1,
      beforePush: async () => {}
    }), /refusing to publish 0\.1\.0-1 over newer AUR version 0\.1\.1-1/)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("first AUR package push creates the initial master branch only after an eligibility recheck", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-aur-first-push-"))
  const remotePath = path.join(temporaryRoot, "aur.git")
  const checkoutPath = path.join(temporaryRoot, "checkout")
  const files = aurPackageFiles(version, 1, "f".repeat(64))
  try {
    const initialized = spawnSync("git", ["init", "--bare", "--initial-branch=master", remotePath], { encoding: "utf8" })
    assert.equal(initialized.status, 0, initialized.stderr)
    const checkout = spawnSync("git", ["init", "--initial-branch=master", checkoutPath], { encoding: "utf8" })
    assert.equal(checkout.status, 0, checkout.stderr)
    await gitCommand(checkoutPath, ["remote", "add", "origin", remotePath])
    await configureGitIdentity(checkoutPath)
    let checks = 0
    const result = await synchronizeAurCheckout({
      checkoutPath,
      files,
      version,
      pkgrel: 1,
      beforePush: async () => { checks += 1 }
    })
    assert.equal(result.changed, true)
    assert.equal(checks, 1)
    const refs = spawnSync("git", ["--git-dir", remotePath, "rev-parse", "refs/heads/master"], { encoding: "utf8" })
    assert.equal(refs.status, 0, refs.stderr)
    assert.equal(refs.stdout.trim(), result.commit)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("AUR synchronization fetches a competing package update before retrying its push", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-aur-race-test-"))
  const remotePath = path.join(temporaryRoot, "aur.git")
  const checkoutPath = path.join(temporaryRoot, "publisher")
  const competitorPath = path.join(temporaryRoot, "competitor")
  const initialFiles = aurPackageFiles("0.1.0", 1, "a".repeat(64))
  const releaseFiles = aurPackageFiles("0.1.1", 1, "b".repeat(64))
  try {
    const initialized = spawnSync("git", ["init", "--bare", "--initial-branch=master", remotePath], { encoding: "utf8" })
    assert.equal(initialized.status, 0, initialized.stderr)
    const cloned = spawnSync("git", ["clone", remotePath, checkoutPath], { encoding: "utf8" })
    assert.equal(cloned.status, 0, cloned.stderr)
    await configureGitIdentity(checkoutPath)
    await writeAurFiles(checkoutPath, initialFiles)
    await gitCommand(checkoutPath, ["add", "PKGBUILD", ".SRCINFO", "elef-bin.install"])
    await gitCommand(checkoutPath, ["commit", "-m", "Initial AUR package"])
    await gitCommand(checkoutPath, ["push", "origin", "HEAD:master"])
    const competitor = spawnSync("git", ["clone", remotePath, competitorPath], { encoding: "utf8" })
    assert.equal(competitor.status, 0, competitor.stderr)
    await configureGitIdentity(competitorPath)

    let checks = 0
    const result = await synchronizeAurCheckout({
      checkoutPath,
      files: releaseFiles,
      version: "0.1.1",
      pkgrel: 1,
      beforePush: async () => {
        checks += 1
        if (checks === 1) {
          await writeFile(path.join(competitorPath, "release-race-marker"), "kept\n")
          await gitCommand(competitorPath, ["add", "release-race-marker"])
          await gitCommand(competitorPath, ["commit", "-m", "Concurrent AUR metadata"])
          await gitCommand(competitorPath, ["push", "origin", "HEAD:master"])
        }
      }
    })
    assert.equal(result.changed, true)
    assert.equal(checks, 2, "the publisher must recheck eligibility before the retry push")
    const remoteMarker = spawnSync("git", ["--git-dir", remotePath, "show", "master:release-race-marker"], { encoding: "utf8" })
    assert.equal(remoteMarker.status, 0, remoteMarker.stderr)
    assert.equal(remoteMarker.stdout, "kept\n")
    assert.equal(await readFile(path.join(checkoutPath, ".SRCINFO"), "utf8"), releaseFiles[".SRCINFO"])
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

function srcinfo(packageVersion, pkgrel, checksum) {
  const filename = "elef-" + packageVersion + "-x86_64.tar.zst"
  return [
    "pkgbase = elef-bin",
    "\tpkgdesc = Offline-first desktop authoring for Elef decks",
    "\tpkgver = " + packageVersion,
    "\tpkgrel = " + pkgrel,
    "\tarch = x86_64",
    "\tsource = " + filename + "::" + archReleaseAssetUrl(packageVersion),
    "\tsha256sums = " + checksum,
    "pkgname = elef-bin",
    ""
  ].join("\n")
}

function aurPackageFiles(packageVersion, pkgrel, checksum) {
  return {
    PKGBUILD: "pkgname=elef-bin\npkgver=" + packageVersion + "\npkgrel=" + pkgrel + "\n",
    ".SRCINFO": srcinfo(packageVersion, pkgrel, checksum),
    "elef-bin.install": "post_install() {}\n"
  }
}

async function configureGitIdentity(repositoryPath) {
  await gitCommand(repositoryPath, ["config", "user.name", "Test AUR Publisher"])
  await gitCommand(repositoryPath, ["config", "user.email", "aur-test@example.invalid"])
}

async function writeAurFiles(directory, files) {
  await mkdir(directory, { recursive: true })
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(directory, name), value)
}

async function gitCommand(repositoryPath, args) {
  const result = spawnSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
}
