import { appendFile, readFile } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { parseLedger } from "../release/ledger.mjs"
import { GitHubPublisher, releaseNotes } from "../release/github-publisher.mjs"

const [pagesRootArgument] = process.argv.slice(2)
if (!pagesRootArgument) throw new Error("usage: node finalize_desktop_release_notes.mjs <gh-pages-checkout>")
const pagesRoot = path.resolve(pagesRootArgument)
const repository = requiredEnv("GITHUB_REPOSITORY")
const token = requiredEnv("GITHUB_TOKEN")
const [owner, repositoryName] = repository.split("/")
if (!owner || !repositoryName) throw new Error("GITHUB_REPOSITORY must use owner/repository form")
const publisher = new GitHubPublisher({ owner, repository: repositoryName, token })
const versions = new Set()
for (const [key, value] of [
  ["MACOS_CANDIDATE", process.env.MACOS_CANDIDATE],
  ["LINUX_CANDIDATE", process.env.LINUX_CANDIDATE],
  ["AUR_CANDIDATE", process.env.AUR_CANDIDATE]
]) {
  if (value) versions.add(parseCandidate(value, key).version)
}
for (const value of [process.env.MACOS_RELEASE_VERSION, process.env.LINUX_RELEASE_VERSION, process.env.AUR_RELEASE_VERSION]) {
  if (value) versions.add(parseVersion(value))
}
const controlAction = process.env.DESKTOP_RELEASE_ACTION || "reconcile"
if (["block", "unblock"].includes(controlAction)) {
  for (const version of (process.env.DESKTOP_RELEASE_VERSIONS || "").split(/[\s,]+/).filter(Boolean)) versions.add(parseVersion(version))
}

await refreshPages(pagesRoot)
const ledger = parseLedger(await readFile(path.join(pagesRoot, "desktop/stable/state.json"), "utf8"))
const updated = []
for (const version of versions) {
  const releaseRecord = ledger.releases.find(release => release.version === version)
  if (!releaseRecord) continue
  const release = await publisher.request(`/releases/tags/${encodeURIComponent(releaseRecord.tag)}`, { allowNotFound: true })
  if (!release) {
    process.stdout.write(`No GitHub Release exists yet for ${releaseRecord.tag}; notes remain unpublished.\n`)
    continue
  }
  if (release.tag_name !== releaseRecord.tag) throw new Error(`GitHub release record does not match ${releaseRecord.tag}`)
  const body = releaseRecord.blocked
    ? releaseNotes({
        version,
        sourceSha: releaseRecord.main_sha,
        pr: releaseRecord.pr,
        macos: releaseRecord.macos.status,
        linuxAsset: releaseRecord.linux_asset.status,
        aur: releaseRecord.aur.status,
        blockedReason: releaseRecord.reason
      })
    : releaseNotes({
        version,
        sourceSha: releaseRecord.main_sha,
        pr: releaseRecord.pr,
        macos: releaseRecord.macos.status,
        linuxAsset: releaseRecord.linux_asset.status,
        aur: releaseRecord.aur.status
      })
  await publisher.updateReleaseNotes(release, body)
  updated.push(version)
}

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "## Desktop release notes",
    "",
    `- Control action: \`${controlAction}\``,
    `- Updated releases: ${updated.length ? updated.map(version => `\`desktop-v${version}\``).join(", ") : "none"}`,
    "- Release notes now reflect current platform ledger states and source SHAs."
  ].join("\n") + "\n")
}
process.stdout.write(`Updated release notes for ${updated.length} version(s).\n`)

function parseCandidate(input, name) {
  let candidate
  try {
    candidate = JSON.parse(input)
  } catch {
    throw new TypeError(`${name} is not valid JSON`)
  }
  if (!candidate || !/^desktop-v\d+\.\d+\.\d+$/.test(candidate.tag) || candidate.tag !== `desktop-v${candidate.version}`) {
    throw new TypeError(`${name} does not contain a valid release version`)
  }
  return candidate
}

function parseVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new TypeError("release version must be numeric semantic version")
  return value
}

async function refreshPages(root) {
  if (git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()) throw new Error("release note finalization requires a clean Pages checkout")
  git(root, ["fetch", "origin", "refs/heads/gh-pages"])
  const fetched = git(root, ["rev-parse", "FETCH_HEAD"]).trim()
  git(root, ["reset", "--hard", fetched])
  if (git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() !== "gh-pages") throw new Error("release notes may only follow the gh-pages ledger")
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch {
    throw new Error(`could not refresh the release ledger with Git ${args[0]}`)
  }
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
