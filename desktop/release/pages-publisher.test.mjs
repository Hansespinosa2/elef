import test from "node:test"
import assert from "node:assert/strict"

import { gitCommandArguments, gitPushAuthenticationOptions, publishPagesStateWithRetry } from "./pages-publisher.mjs"

test("Pages pushes use only the short-lived dedicated writer token", () => {
  const options = gitPushAuthenticationOptions("fixture-token")
  assert.equal(options[0], "-c")
  assert.match(options[1], /^http\.https:\/\/github\.com\/.extraheader=AUTHORIZATION: basic /)
  assert.equal(Buffer.from(options[1].split("basic ")[1], "base64").toString("utf8"), "x-access-token:fixture-token")
  assert.doesNotMatch(options[1], /fixture-token/)
  assert.throws(() => gitPushAuthenticationOptions(""), /token is missing/)
  assert.deepEqual(gitCommandArguments("/tmp/pages", ["fetch", "origin"], undefined), ["-C", "/tmp/pages", "fetch", "origin"])
  assert.deepEqual(gitCommandArguments("/tmp/pages", ["push", "origin", "HEAD:refs/heads/gh-pages"], "fixture-token"), [
    "-C", "/tmp/pages", ...options, "push", "origin", "HEAD:refs/heads/gh-pages"
  ])
  assert.throws(() => gitCommandArguments("/tmp/pages", ["push", "origin"], undefined), /token is missing/)
})

test("a competing Pages update causes a fresh reconciliation before the retry push", async () => {
  const remote = { sha: "a".repeat(40), fetchSha: "", localSha: "" }
  let reconcileCount = 0
  let pushCount = 0
  const runGit = (_root, args) => {
    const key = args.join(" ")
    if (key === "rev-parse --abbrev-ref HEAD") return ok("gh-pages\n")
    if (key === "status --porcelain --untracked-files=all") return ok("")
    if (key === "fetch origin refs/heads/gh-pages") {
      remote.fetchSha = remote.sha
      return ok("")
    }
    if (key === "rev-parse FETCH_HEAD") return ok(`${remote.fetchSha}\n`)
    if (key.startsWith("reset --hard ")) {
      remote.localSha = args.at(-1)
      return ok("")
    }
    if (key.startsWith("add -- ")) return ok("")
    if (key.startsWith("diff --cached --quiet -- ")) return { status: 1, stdout: "", stderr: "" }
    if (key.includes(" commit -m Update desktop stable release state")) {
      remote.localSha = pushCount === 0 ? "c".repeat(40) : "d".repeat(40)
      return ok("")
    }
    if (key === "rev-parse HEAD") return ok(`${remote.localSha}\n`)
    if (key === "push origin HEAD:refs/heads/gh-pages") {
      pushCount += 1
      if (pushCount === 1) {
        remote.sha = "b".repeat(40)
        return { status: 1, stdout: "", stderr: "non-fast-forward" }
      }
      remote.sha = remote.localSha
      return ok("")
    }
    if (key === "ls-remote origin refs/heads/gh-pages") return ok(`${remote.sha}\trefs/heads/gh-pages\n`)
    throw new Error(`unexpected git command: ${key}`)
  }

  const result = await publishPagesStateWithRetry({
    pagesRoot: "/tmp/pages",
    runGit,
    reconcile: async () => {
      reconcileCount += 1
      return { processedMerges: [{ sha: `${reconcileCount}`.repeat(40), gate: "passed", version: `0.1.${reconcileCount}` }] }
    }
  })

  assert.equal(result.published, true)
  assert.equal(result.attempts, 2)
  assert.equal(reconcileCount, 2)
  assert.equal(pushCount, 2)
  assert.equal(result.commitSha, "d".repeat(40))
})

test("a rejected push with no remote advancement fails without retrying a stale write", async () => {
  const remote = { sha: "a".repeat(40), fetchSha: "", localSha: "" }
  let reconcileCount = 0
  const runGit = (_root, args) => {
    const key = args.join(" ")
    if (key === "rev-parse --abbrev-ref HEAD") return ok("gh-pages\n")
    if (key === "status --porcelain --untracked-files=all") return ok("")
    if (key === "fetch origin refs/heads/gh-pages") { remote.fetchSha = remote.sha; return ok("") }
    if (key === "rev-parse FETCH_HEAD") return ok(`${remote.fetchSha}\n`)
    if (key.startsWith("reset --hard ")) { remote.localSha = args.at(-1); return ok("") }
    if (key.startsWith("add -- ")) return ok("")
    if (key.startsWith("diff --cached --quiet -- ")) return { status: 1, stdout: "", stderr: "" }
    if (key.includes(" commit -m Update desktop stable release state")) { remote.localSha = "c".repeat(40); return ok("") }
    if (key === "rev-parse HEAD") return ok(`${remote.localSha}\n`)
    if (key === "push origin HEAD:refs/heads/gh-pages") return { status: 1, stdout: "", stderr: "permission denied" }
    if (key === "ls-remote origin refs/heads/gh-pages") return ok(`${remote.sha}\trefs/heads/gh-pages\n`)
    throw new Error(`unexpected git command: ${key}`)
  }

  await assert.rejects(publishPagesStateWithRetry({
    pagesRoot: "/tmp/pages",
    runGit,
    reconcile: async () => { reconcileCount += 1; return { processedMerges: [] } }
  }), /check branch rules and workflow credentials/)
  assert.equal(reconcileCount, 1)
})

function ok(stdout) {
  return { status: 0, stdout, stderr: "" }
}
