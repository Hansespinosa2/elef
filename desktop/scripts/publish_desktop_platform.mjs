import { appendFile, readFile } from "node:fs/promises"
import { createReadStream } from "node:fs"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

import {
  latestPendingPlatformRelease,
  parseLedger,
  publishLinuxAsset,
  publishMacos
} from "../release/ledger.mjs"
import { GitHubPublisher, releaseNotes } from "../release/github-publisher.mjs"
import { publishPagesStateWithRetry } from "../release/pages-publisher.mjs"
import { writePagesStateFiles } from "../release/pages-state.mjs"
import { verifyReleaseStateWriterPolicy } from "../release/release-state-ruleset-api.mjs"

const [pagesRootArgument, artifactManifestArgument] = process.argv.slice(2)
if (!pagesRootArgument || !artifactManifestArgument) {
  throw new Error("usage: node publish_desktop_platform.mjs <gh-pages-checkout> <artifact-manifest.json>")
}

const pagesRoot = path.resolve(pagesRootArgument)
const manifestPath = path.resolve(artifactManifestArgument)
const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
const platform = manifest.platform
if (!["macos", "linux_asset"].includes(platform)) throw new TypeError("platform publisher only accepts macos or linux_asset")
if (!manifest.artifact || manifest.artifact.version !== manifest.version || manifest.artifact.source_sha !== manifest.source_sha) {
  throw new TypeError("artifact metadata does not match its reserved version and source")
}

const repository = requiredEnv("GITHUB_REPOSITORY")
const token = requiredEnv("GITHUB_TOKEN")
const [owner, repositoryName] = repository.split("/")
if (!owner || !repositoryName) throw new Error("GITHUB_REPOSITORY must use owner/repository form")
const releaseStatePolicy = {
  repository,
  appId: requiredEnv("ELEF_RELEASE_STATE_APP_ID"),
  token: requiredEnv("ELEF_RELEASE_STATE_PUSH_TOKEN"),
  expectedUpdatedAt: requiredEnv("ELEF_RELEASE_STATE_RULESET_UPDATED_AT"),
  apiUrl: process.env.GITHUB_API_URL
}
const publisher = new GitHubPublisher({ owner, repository: repositoryName, token })
await verifyReleaseStateWriterPolicy(releaseStatePolicy)
await refreshPages(pagesRoot)
await assertEligible()

await publisher.ensureTagAt(manifest.tag, manifest.source_sha)
await refreshPages(pagesRoot)
await assertEligible()
const { release } = await publisher.ensureDraftRelease({
  tag: manifest.tag,
  version: manifest.version,
  sourceSha: manifest.source_sha,
  pr: manifest.pr
})

await verifyArtifactManifest()
const verifiedAssets = await publisher.ensureReleaseAssets(release, manifest.files, {
  beforeUpload: async () => {
    await refreshPages(pagesRoot)
    await assertEligible()
  }
})
await refreshPages(pagesRoot)
const beforeExposure = await currentLedger()
assertEligibleInLedger(beforeExposure)
const provisional = provisionalStatuses(beforeExposure)
const provisionalBody = releaseNotes({
  version: manifest.version,
  sourceSha: manifest.source_sha,
  pr: manifest.pr,
  ...provisional
})
await verifyReleaseStateWriterPolicy(releaseStatePolicy)
await publisher.exposeRelease(release, provisionalBody, verifiedAssets)

await verifyReleaseStateWriterPolicy(releaseStatePolicy)
const stateResult = await publishPagesStateWithRetry({
  pagesRoot,
  reconcile: async () => {
    const ledger = await currentLedger()
    assertEligibleInLedger(ledger)
    const releaseRecord = requireRelease(ledger)
    const next = platform === "macos"
      ? publishMacos(ledger, manifest.version, manifest.artifact, { expectedRevision: ledger.revision })
      : publishLinuxAsset(ledger, manifest.version, manifest.artifact, { expectedRevision: ledger.revision })
    await writePagesStateFiles(pagesRoot, next)
    return { version: manifest.version, platform, previousRevision: ledger.revision, revision: next.revision, releaseRecord }
  }
})

const ledgerAfter = await currentLedger()
const publishedRelease = requireRelease(ledgerAfter)
const nextAur = latestPendingPlatformRelease(ledgerAfter, "aur")
const result = {
  version: manifest.version,
  platform,
  revision: ledgerAfter.revision,
  pages_commit: stateResult.commitSha || "",
  aur_candidate: nextAur ? JSON.stringify({ version: nextAur.version, tag: nextAur.tag, main_sha: nextAur.main_sha, pr: nextAur.pr }) : "",
  public: publishedRelease.public,
  blocked: publishedRelease.blocked
}
await writeOutput(result)
await writeSummary(result)
process.stdout.write(`Published verified ${platform} assets for ${manifest.tag}; Pages ledger revision ${result.revision}.\n`)

async function verifyArtifactManifest() {
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new TypeError("release artifact manifest has no files")
  const byName = new Map(manifest.files.map(file => [file.name, file]))
  if (byName.size !== manifest.files.length) throw new TypeError("release artifact manifest contains duplicate filenames")
  for (const file of manifest.files) {
    if (typeof file.path !== "string" || !/^[a-f0-9]{64}$/i.test(file.sha256)) throw new TypeError(`release asset ${file.name} lacks a path or SHA-256`)
    const actual = await hashFile(file.path)
    if (actual !== file.sha256.toLowerCase()) throw new Error(`release asset ${file.name} changed after build validation`)
  }

  if (platform === "macos") {
    const archiveName = path.basename(new URL(manifest.artifact.updater_url).pathname)
    const dmgName = path.basename(new URL(manifest.artifact.dmg_url).pathname)
    const archive = byName.get(archiveName)
    const signatureFile = byName.get(`${archiveName}.sig`)
    const dmg = byName.get(dmgName)
    if (!archive || !signatureFile || !dmg || byName.size !== 3) throw new Error("macOS release must contain only its updater archive, signature, and DMG")
    if (archive.sha256 !== manifest.artifact.updater_sha256 || dmg.sha256 !== manifest.artifact.dmg_sha256) {
      throw new Error("macOS release asset hashes disagree with the signed artifact manifest")
    }
    const signature = (await readFile(signatureFile.path, "utf8")).trim()
    if (signature !== manifest.artifact.signature || manifest.artifact.signature_verified !== true) {
      throw new Error("macOS updater signature metadata is inconsistent")
    }
    const verification = spawnSync(process.execPath, [
      path.join(path.dirname(fileURLToPath(import.meta.url)), "verify_updater_signature.mjs"),
      archive.path,
      signatureFile.path,
      manifest.version
    ], { encoding: "utf8", env: process.env, maxBuffer: 1024 * 1024 })
    if (verification.error || verification.status !== 0) {
      process.stderr.write(verification.stderr || "updater signature verification failed\n")
      process.exit(verification.status || 1)
    }
  } else {
    const filename = `elef-${manifest.version}-x86_64.tar.zst`
    const archive = byName.get(filename)
    const checksumFile = byName.get(`${filename}.sha256`)
    const provenanceFile = byName.get(`${filename}.provenance.json`)
    if (!archive || !checksumFile || !provenanceFile || byName.size !== 3) throw new Error("Linux release must contain only the native archive and its verification sidecars")
    if (manifest.artifact.filename !== filename || manifest.artifact.sha256 !== archive.sha256) throw new Error("Linux release asset hashes disagree with the package metadata")
    const checksumText = await readFile(checksumFile.path, "utf8")
    if (parseChecksum(checksumText, filename) !== archive.sha256) throw new Error("Linux SHA-256 sidecar does not match the native archive")
    const provenance = JSON.parse(await readFile(provenanceFile.path, "utf8"))
    if (provenance.version !== manifest.version || provenance.main_sha !== manifest.source_sha || provenance.sha256 !== archive.sha256 || provenance.architecture !== "x86_64") {
      throw new Error("Linux archive provenance does not match its reserved source SHA")
    }
  }
}

function provisionalStatuses(ledger) {
  const release = requireRelease(ledger)
  return {
    macos: platform === "macos" ? "passed" : release.macos.status,
    linuxAsset: platform === "linux_asset" ? "passed" : release.linux_asset.status,
    aur: release.aur.status
  }
}

async function assertEligible() {
  assertEligibleInLedger(await currentLedger())
}

function assertEligibleInLedger(ledger) {
  const release = requireRelease(ledger)
  if (release.main_sha !== manifest.source_sha || release.pr !== manifest.pr || release.tag !== manifest.tag || release.gate !== "passed" || release.blocked) {
    throw new Error(`central ledger no longer authorizes ${manifest.tag}`)
  }
  const candidate = latestPendingPlatformRelease(ledger, platform)
  if (!candidate || candidate.version !== manifest.version || candidate.main_sha !== manifest.source_sha) {
    throw new Error(`central ledger no longer selects ${manifest.tag} for ${platform}`)
  }
}

async function currentLedger() {
  return parseLedger(await readFile(path.join(pagesRoot, "desktop/stable/state.json"), "utf8"))
}

function requireRelease(ledger) {
  const release = ledger.releases.find(item => item.version === manifest.version)
  if (!release) throw new Error(`central ledger has no reservation for ${manifest.version}`)
  return release
}

async function refreshPages(root) {
  if (git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()) throw new Error("platform publication requires a clean Pages checkout")
  git(root, ["fetch", "origin", "refs/heads/gh-pages"])
  const fetched = git(root, ["rev-parse", "FETCH_HEAD"]).trim()
  git(root, ["reset", "--hard", fetched])
  if (git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() !== "gh-pages") throw new Error("platform publication may only read state from gh-pages")
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch {
    throw new Error(`could not refresh central release state with Git ${args[0]}`)
  }
}

function parseChecksum(serialized, filename) {
  const match = /^([a-f0-9]{64})\s+\*?([^\r\n]+)\s*$/i.exec(serialized)
  if (!match || match[2] !== filename) throw new Error("Linux package checksum sidecar has an unexpected filename")
  return match[1].toLowerCase()
}

async function hashFile(filename) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest("hex")
}

async function writeOutput(values) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  await appendFile(output, [
    `release_version=${values.version}`,
    `platform=${values.platform}`,
    `revision=${values.revision}`,
    `pages_commit=${values.pages_commit}`,
    `aur_candidate=${values.aur_candidate}`
  ].join("\n") + "\n")
}

async function writeSummary(values) {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  await appendFile(summary, [
    "## Desktop platform publication",
    "",
    `- Release: \`${manifest.tag}\``,
    `- Platform: \`${values.platform}\``,
    `- Source SHA: \`${manifest.source_sha}\``,
    `- Pages ledger revision: \`${values.revision}\``,
    "- GitHub assets were hash-checked, and the release was made public before its platform was marked passed in the safe ledger."
  ].join("\n") + "\n")
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
