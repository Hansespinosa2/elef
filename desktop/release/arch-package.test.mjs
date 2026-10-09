import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, rm, symlink as createSymlink, writeFile } from "node:fs/promises"
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
