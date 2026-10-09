import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"

import { parseLedger } from "./ledger.mjs"

const STATE_FILES = ["desktop/stable/state.json", "desktop/stable/latest.json"]

/**
 * Publish the derived Pages files with a fast-forward compare-and-swap.
 * Recompute from the new remote ledger whenever another writer wins the race.
 */
export async function publishPagesStateWithRetry({ pagesRoot, reconcile, runGit = runGitCommand, maxAttempts = 5 }) {
  if (!pagesRoot || typeof reconcile !== "function") throw new TypeError("Pages publishing needs a checkout and reconciliation callback")
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be a positive integer")

  const branch = runChecked(runGit(pagesRoot, ["rev-parse", "--abbrev-ref", "HEAD"]), "read Pages branch").trim()
  if (branch !== "gh-pages") throw new Error("release state may only be written from the gh-pages branch")
  const initialStatus = runChecked(runGit(pagesRoot, ["status", "--porcelain", "--untracked-files=all"]), "check Pages checkout").trim()
  if (initialStatus) throw new Error("Pages checkout must be clean before release-state publication")

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    runChecked(runGit(pagesRoot, ["fetch", "origin", "refs/heads/gh-pages"]), "fetch Pages state")
    const baseSha = runChecked(runGit(pagesRoot, ["rev-parse", "FETCH_HEAD"]), "read remote Pages SHA").trim()
    runChecked(runGit(pagesRoot, ["reset", "--hard", baseSha]), "refresh Pages checkout")
    const before = await readOptionalLedger(path.join(pagesRoot, STATE_FILES[0]))
    const reconciliation = await reconcile({ pagesRoot, attempt })
    const staged = runGit(pagesRoot, ["add", "--", ...STATE_FILES])
    runChecked(staged, "stage Pages state")
    const difference = runGit(pagesRoot, ["diff", "--cached", "--quiet", "--", ...STATE_FILES])
    if (difference.status === 0) {
      return { ...resultFor(before, before, reconciliation), attempts: attempt, published: false }
    }
    if (difference.status !== 1) throw new Error("could not compare generated Pages state")

    runChecked(runGit(pagesRoot, [
      "-c", "user.name=elef-release[bot]",
      "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit", "-m", "Update desktop stable release state"
    ]), "commit Pages state")
    const commitSha = runChecked(runGit(pagesRoot, ["rev-parse", "HEAD"]), "read Pages commit SHA").trim()
    const push = runGit(pagesRoot, ["push", "origin", "HEAD:refs/heads/gh-pages"])
    if (push.status === 0) {
      const after = await readOptionalLedger(path.join(pagesRoot, STATE_FILES[0]))
      return { ...resultFor(before, after, reconciliation), attempts: attempt, published: true, commitSha }
    }

    const remoteAfterPush = runGit(pagesRoot, ["ls-remote", "origin", "refs/heads/gh-pages"])
    if (remoteAfterPush.status !== 0) throw new Error("could not verify the Pages branch after a rejected push")
    const observedSha = remoteAfterPush.stdout.trim().split(/\s+/)[0]
    if (observedSha === commitSha) {
      const after = await readOptionalLedger(path.join(pagesRoot, STATE_FILES[0]))
      return { ...resultFor(before, after, reconciliation), attempts: attempt, published: true, commitSha }
    }
    if (observedSha === baseSha) {
      throw new Error("Pages state push was rejected; check branch rules and workflow credentials")
    }
  }

  throw new Error(`Pages state changed during all ${maxAttempts} compare-and-swap attempts`)
}

async function readOptionalLedger(filename) {
  try {
    return parseLedger(await readFile(filename, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function resultFor(before, after, reconciliation) {
  const processed = reconciliation?.processedMerges || []
  if (before && after && before.revision > after.revision) {
    throw new Error("Pages ledger revision moved backwards")
  }
  return { reconciliation, processedMerges: processed, failedGateCount: processed.filter(merge => merge.gate === "failed_gate").length }
}

function runGitCommand(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 })
  if (result.error) throw new Error("could not run Git for Pages state publication")
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" }
}

function runChecked(result, action) {
  if (result.status !== 0) throw new Error(`could not ${action}`)
  return result.stdout
}
