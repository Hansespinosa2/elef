import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

import { GitHubPublisher } from "../release/github-publisher.mjs"
import { ARCH_PACKAGE_NAMES, renderArchPkgbuild } from "../release/arch-package.mjs"
import { assertAurCandidate, readPackageFiles, selectAurPackageName, synchronizeAurCheckout, validateAurSrcInfo } from "../release/aur-publisher.mjs"
import { verifyPublishedLinuxArtifact } from "../release/aur-github.mjs"
import { parseLedger, publishAur } from "../release/ledger.mjs"
import { publishPagesStateWithRetry } from "../release/pages-publisher.mjs"
import { verifyReleaseStateWriterPolicy } from "../release/release-state-ruleset-api.mjs"
import { writePagesStateFiles } from "../release/pages-state.mjs"

const [pagesRootArgument, candidatePathArgument, packageDirectoryArgument] = process.argv.slice(2)
if (!pagesRootArgument || !candidatePathArgument || !packageDirectoryArgument) {
  throw new Error("usage: node publish_desktop_aur.mjs <gh-pages-checkout> <candidate.json> <package-directory>")
}
const pagesRoot = path.resolve(pagesRootArgument)
const candidatePath = path.resolve(candidatePathArgument)
const packageDirectory = path.resolve(packageDirectoryArgument)
const candidate = parseCandidate(await readFile(candidatePath, "utf8"))
const metadata = JSON.parse(await readFile(path.join(packageDirectory, "release-metadata.json"), "utf8"))
const repository = process.env.GITHUB_REPOSITORY || "Hansespinosa2/elef"
if (repository.toLowerCase() !== "hansespinosa2/elef") throw new Error("AUR publishing is allowed only for the Elef release repository")
const githubToken = requiredEnv("GITHUB_TOKEN")
const releaseStatePolicy = {
  repository,
  appId: requiredEnv("ELEF_RELEASE_STATE_APP_ID"),
  token: requiredEnv("ELEF_RELEASE_STATE_PUSH_TOKEN"),
  expectedUpdatedAt: requiredEnv("ELEF_RELEASE_STATE_RULESET_UPDATED_AT"),
  apiUrl: process.env.GITHUB_API_URL
}
const publisher = new GitHubPublisher({ owner: "Hansespinosa2", repository: "elef", token: githubToken })
const maintainer = requiredEnv("AUR_ACCOUNT_NAME")
const privateKey = requiredEnv("AUR_SSH_PRIVATE_KEY")
const knownHosts = requiredEnv("AUR_SSH_KNOWN_HOSTS")
if (!ARCH_PACKAGE_NAMES.includes(metadata.package_name)) throw new Error("prepared AUR metadata uses an unapproved package name")
const aurUrl = `ssh://aur@aur.archlinux.org/${metadata.package_name}.git`
const workRoot = await mkdtemp(path.join(os.tmpdir(), "elef-aur-publisher-"))

try {
  await verifyReleaseStateWriterPolicy(releaseStatePolicy)
  let ledger = await currentLedger()
  let releaseRecord = assertAurCandidate(ledger, candidate)
  const verified = await verifyPublishedLinuxArtifact({ publisher, candidate, releaseRecord })
  const files = await readPackageFiles(packageDirectory, metadata.package_name)
  const expectedPkgbuild = await renderArchPkgbuild({ version: candidate.version, sha256: verified.artifact.sha256, packageName: metadata.package_name })
  if (files.PKGBUILD !== expectedPkgbuild) throw new Error("AUR PKGBUILD differs from the checked-in immutable asset template")
  const installFile = await readFile(new URL("../packaging/arch/elef-bin.install", import.meta.url), "utf8")
  if (files[`${metadata.package_name}.install`] !== installFile) throw new Error("AUR package install hooks differ from the checked-in package")
  const srcInfoMetadata = {
    package_name: metadata.package_name,
    version: candidate.version,
    pkgrel: metadata.pkgrel,
    filename: verified.archiveName,
    asset_url: verified.artifact.asset_url,
    asset_sha256: verified.artifact.sha256
  }
  validatePackageMetadata(metadata, candidate, verified.artifact)
  validateAurSrcInfo(files[".SRCINFO"], srcInfoMetadata)
  const packageMetadata = {
    version: candidate.version,
    pkgver: candidate.version,
    pkgrel: metadata.pkgrel,
    package_name: metadata.package_name,
    source_sha: candidate.main_sha,
    asset_sha256: verified.artifact.sha256,
    pkgbuild_sha256: hash(files.PKGBUILD),
    srcinfo_sha256: hash(files[".SRCINFO"])
  }

  const ssh = await configureSsh(workRoot, privateKey, knownHosts)
  const checkoutPath = path.join(workRoot, "aur")
  await cloneOrInitializeAur(checkoutPath, aurUrl, ssh)
  const gitEnv = { ...process.env, GIT_SSH_COMMAND: ssh.command }
  await git(checkoutPath, ["config", "user.name", "Elef Release Coordinator"], gitEnv)
  await git(checkoutPath, ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], gitEnv)

  const synchronized = await synchronizeAurCheckout({
    checkoutPath,
    files,
    version: candidate.version,
    pkgrel: metadata.pkgrel,
    packageName: metadata.package_name,
    git: (root, args) => git(root, args, gitEnv),
    beforePush: async () => {
      await verifyReleaseStateWriterPolicy(releaseStatePolicy)
      await refreshPages(pagesRoot)
      ledger = await currentLedger()
      releaseRecord = assertAurCandidate(ledger, candidate)
      if (await selectAurPackageName(ledger, { maintainer }) !== metadata.package_name) throw new Error("AUR package name is no longer available to the configured Elef account")
      const currentRemote = await verifyPublishedLinuxArtifact({ publisher, candidate, releaseRecord })
      if (currentRemote.artifact.sha256 !== packageMetadata.asset_sha256) throw new Error("AUR upstream asset changed immediately before publication")
    }
  })

  await verifyReleaseStateWriterPolicy(releaseStatePolicy)
  const stateResult = await publishPagesStateWithRetry({
    pagesRoot,
    reconcile: async () => {
      const current = await currentLedger()
      assertAurCandidate(current, candidate)
      const next = publishAur(current, candidate.version, packageMetadata, { expectedRevision: current.revision })
      await writePagesStateFiles(pagesRoot, next)
      return { version: candidate.version, revision: next.revision, aur_commit: synchronized.commit, changed: synchronized.changed }
    }
  })
  const result = {
    version: candidate.version,
    commit: synchronized.commit,
    changed: synchronized.changed,
    revision: stateResult.reconciliation?.revision || "",
    pages_commit: stateResult.commitSha || ""
  }
  await writeOutput(result)
  await writeSummary(result)
  process.stdout.write(`Published ${metadata.package_name} ${metadata.pkgver}-${metadata.pkgrel} from ${candidate.tag}; AUR commit ${result.commit}.\n`)
} finally {
  await rm(workRoot, { recursive: true, force: true })
}

async function currentLedger() {
  return parseLedger(await readFile(path.join(pagesRoot, "desktop/stable/state.json"), "utf8"))
}

async function refreshPages(root) {
  if ((await git(root, ["status", "--porcelain", "--untracked-files=all"])).stdout.trim()) throw new Error("AUR publication requires a clean Pages checkout")
  const fetched = await git(root, ["fetch", "origin", "refs/heads/gh-pages"])
  if (fetched.status !== 0) throw new Error("could not refresh central release state before AUR publication")
  const head = await git(root, ["rev-parse", "FETCH_HEAD"])
  if (head.status !== 0) throw new Error("could not read the latest Pages release-state commit")
  const reset = await git(root, ["reset", "--hard", head.stdout.trim()])
  if (reset.status !== 0) throw new Error("could not refresh the Pages release-state checkout")
  const branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch.status !== 0 || branch.stdout.trim() !== "gh-pages") throw new Error("AUR publication may only read state from gh-pages")
}

async function configureSsh(root, key, hosts) {
  const hasPinnedAurHost = hosts.split(/\r?\n/).some(line => /^(?:aur\.archlinux\.org|\[aur\.archlinux\.org\]:22)\s/.test(line))
  if (!hasPinnedAurHost) throw new Error("protected AUR known-hosts configuration must pin aur.archlinux.org")
  const sshDirectory = path.join(root, ".ssh")
  await mkdir(sshDirectory, { mode: 0o700 })
  const keyPath = path.join(sshDirectory, "aur_ed25519")
  const knownHostsPath = path.join(sshDirectory, "known_hosts")
  await writeFile(keyPath, `${key.trim()}\n`, { mode: 0o600 })
  await writeFile(knownHostsPath, `${hosts.trim()}\n`, { mode: 0o600 })
  const command = `ssh -i '${keyPath}' -o IdentitiesOnly=yes -o UserKnownHostsFile='${knownHostsPath}' -o StrictHostKeyChecking=yes`
  return { keyPath, knownHostsPath, command }
}

async function cloneOrInitializeAur(checkoutPath, remote, ssh) {
  const cloned = await git(workRoot, ["clone", remote, checkoutPath], { ...process.env, GIT_SSH_COMMAND: ssh.command })
  if (cloned.status === 0) return
  const probe = await git(workRoot, ["ls-remote", "--heads", remote, "master"], { ...process.env, GIT_SSH_COMMAND: ssh.command })
  if (probe.status !== 0 || probe.stdout.trim()) throw new Error("could not clone the registered AUR package using the protected SSH identity")
  await mkdir(checkoutPath, { recursive: true })
  const initialized = await git(checkoutPath, ["init", "--initial-branch=master"])
  if (initialized.status !== 0) throw new Error("could not initialize the first AUR package checkout")
  const added = await git(checkoutPath, ["remote", "add", "origin", remote])
  if (added.status !== 0) throw new Error("could not configure the AUR package remote")
}

async function git(directory, args, env = process.env) {
  const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, env })
  if (result.error) return { status: 1, stdout: "" }
  return { status: result.status ?? 1, stdout: result.stdout || "" }
}

function validatePackageMetadata(metadata, candidate, artifact) {
  if (metadata.schema_version !== 1 || !ARCH_PACKAGE_NAMES.includes(metadata.package_name) || metadata.version !== candidate.version ||
    metadata.pkgver !== candidate.version || metadata.pkgrel !== 1 || metadata.tag !== candidate.tag || metadata.source_sha !== candidate.main_sha ||
    metadata.pr !== candidate.pr || metadata.filename !== artifact.filename || metadata.asset_url !== artifact.asset_url ||
    metadata.asset_sha256 !== artifact.sha256) {
    throw new Error("prepared AUR package metadata does not match its public Linux release")
  }
}

function parseCandidate(serialized) {
  let candidate
  try {
    candidate = JSON.parse(serialized)
  } catch {
    throw new TypeError("AUR candidate is not valid JSON")
  }
  if (!candidate || !/^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(candidate.tag) ||
    candidate.tag !== `desktop-v${candidate.version}` || !/^[a-f\d]{40}$/i.test(candidate.main_sha) || !Number.isInteger(candidate.pr)) {
    throw new TypeError("AUR candidate does not contain the reserved version, tag, source SHA and PR")
  }
  return candidate
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function writeOutput(result) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  await appendFile(output, [
    `release_version=${result.version}`,
    `aur_commit=${result.commit}`,
    `changed=${result.changed}`,
    `pages_commit=${result.pages_commit}`
  ].join("\n") + "\n")
}

async function writeSummary(result) {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  await appendFile(summary, [
    "## AUR package publication",
    "",
    `- Package: \`${metadata.package_name}\` version \`${result.version}-1\``,
    `- AUR commit: \`${result.commit}\``,
    `- Package metadata changed: \`${result.changed}\``,
    `- Pages ledger commit: ${result.pages_commit ? `\`${result.pages_commit}\`` : "unchanged"}`,
    "- The package was published only after public GitHub archive, checksum and provenance verification."
  ].join("\n") + "\n")
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
