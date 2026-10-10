import { readFile } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { latestPendingPlatformRelease, parseLedger } from "../release/ledger.mjs"
import { GitHubPublisher } from "../release/github-publisher.mjs"

const [pagesRootArgument] = process.argv.slice(2)
if (!pagesRootArgument) throw new Error("usage: node prepare_desktop_releases.mjs <gh-pages-checkout>")
const pagesRoot = path.resolve(pagesRootArgument)
const repository = requiredEnv("GITHUB_REPOSITORY")
const token = requiredEnv("GITHUB_TOKEN")
const [owner, repositoryName] = repository.split("/")
if (!owner || !repositoryName) throw new Error("GITHUB_REPOSITORY must use owner/repository form")

const publisher = new GitHubPublisher({ owner, repository: repositoryName, token })
const candidates = new Map()
for (const platform of ["macos", "linux_asset"]) {
  const key = platform === "macos" ? "MACOS_CANDIDATE" : "LINUX_CANDIDATE"
  const input = process.env[key]
  if (!input) continue
  const candidate = parseCandidate(input, key)
  const existing = candidates.get(candidate.version)
  if (existing && (existing.main_sha !== candidate.main_sha || existing.pr !== candidate.pr)) {
    throw new Error(`platform candidates disagree about source identity for ${candidate.version}`)
  }
  candidates.set(candidate.version, candidate)
}

for (const candidate of candidates.values()) {
  await refreshPages(pagesRoot)
  const ledger = parseLedger(await readFile(path.join(pagesRoot, "desktop/stable/state.json"), "utf8"))
  const current = ledger.releases.find(release => release.version === candidate.version)
  if (!current || current.main_sha !== candidate.main_sha || current.pr !== candidate.pr || current.blocked || current.gate !== "passed") {
    process.stdout.write(`Skip ${candidate.version}: the central release ledger no longer authorizes this candidate.\n`)
    continue
  }
  const eligible = ["macos", "linux_asset"].some(platform => {
    const latest = latestPendingPlatformRelease(ledger, platform)
    return latest?.version === candidate.version && latest.main_sha === candidate.main_sha
  })
  if (!eligible) {
    process.stdout.write(`Skip ${candidate.version}: newer validated platform releases superseded it.\n`)
    continue
  }

  await publisher.ensureTagAt(candidate.tag, candidate.main_sha)
  const prepared = await publisher.ensureDraftRelease({
    tag: candidate.tag,
    version: candidate.version,
    sourceSha: candidate.main_sha,
    pr: candidate.pr
  })
  process.stdout.write(`${prepared.created ? "Created" : "Reused"} ${candidate.tag} at ${candidate.main_sha} as ${prepared.release.draft ? "draft" : "public"}.\n`)
}

function parseCandidate(input, name) {
  let candidate
  try {
    candidate = JSON.parse(input)
  } catch {
    throw new TypeError(`${name} is not valid JSON`)
  }
  if (!candidate || !/^desktop-v\d+\.\d+\.\d+$/.test(candidate.tag) || candidate.tag !== `desktop-v${candidate.version}` ||
      !/^[a-f0-9]{40}$/i.test(candidate.main_sha) || !Number.isInteger(candidate.pr) || candidate.pr < 1) {
    throw new TypeError(`${name} lacks valid immutable release identity`)
  }
  return candidate
}

async function refreshPages(root) {
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  if (status) throw new Error("release preparation requires a clean Pages checkout")
  git(root, ["fetch", "origin", "refs/heads/gh-pages"])
  const fetched = git(root, ["rev-parse", "FETCH_HEAD"]).trim()
  git(root, ["reset", "--hard", fetched])
  if (git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() !== "gh-pages") {
    throw new Error("release preparation may only read state from the gh-pages branch")
  }
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch {
    throw new Error(`could not run Git command ${args[0]} for release preparation`)
  }
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
