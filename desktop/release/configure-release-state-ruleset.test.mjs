import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { releaseStateWriterRuleset } from "./release-state-ruleset.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const configureScript = path.join(repositoryRoot, "desktop/scripts/configure_release_state_ruleset.mjs")
const fixtureAppId = 481516
const fixtureRepository = "Hansespinosa2/elef"
const fakeGhProgram = [
  "#!/usr/bin/env node",
  "const fs = require('node:fs')",
  "const statePath = process.env.FAKE_GH_STATE",
  "const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))",
  "const args = process.argv.slice(2)",
  "if (args.shift() !== 'api') process.exit(90)",
  "const methodIndex = args.indexOf('--method')",
  "const method = methodIndex < 0 ? 'GET' : args[methodIndex + 1]",
  "const endpoint = args.find(arg => arg.startsWith('repos/'))",
  "if (!endpoint) process.exit(91)",
  "state.calls.push({ method, endpoint })",
  "let result",
  "if (endpoint.endsWith('/rulesets') && method === 'POST') {",
  "  const body = JSON.parse(fs.readFileSync(0, 'utf8'))",
  "  state.rule = { ...body, id: 77, source_type: 'Repository', source: process.env.GITHUB_REPOSITORY }",
  "  state.calls.at(-1).body = body",
  "  result = state.rule",
  "} else if (endpoint.endsWith('/rulesets?per_page=100')) {",
  "  result = state.rule ? [{ id: state.rule.id, name: state.rule.name, source_type: state.rule.source_type, source: state.rule.source }] : []",
  "} else if (endpoint.endsWith('/rulesets/77?includes_parents=true')) {",
  "  if (!state.rule) process.exit(92)",
  "  result = state.rule",
  "} else {",
  "  process.exit(93)",
  "}",
  "fs.writeFileSync(statePath, JSON.stringify(state))",
  "process.stdout.write(JSON.stringify(result))"
].join("\n")

test("ruleset setup reads the full matching ruleset after the summary list", async t => {
  const fixture = await makeGhFixture(t, {
    calls: [],
    rule: { ...releaseStateWriterRuleset(fixtureAppId), id: 77, source_type: "Repository", source: fixtureRepository }
  })
  const result = runSetup(fixture, [])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Verified desktop-release-state-writer \(77\)/)
  const state = await fixture.readState()
  assert.deepEqual(state.calls.map(call => call.endpoint), [
    "repos/" + fixtureRepository + "/rulesets?per_page=100",
    "repos/" + fixtureRepository + "/rulesets/77?includes_parents=true"
  ])
})

test("ruleset setup creates an update-only rule and verifies its full server record", async t => {
  const fixture = await makeGhFixture(t, { calls: [], rule: null })
  const result = runSetup(fixture, ["--apply"])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Configured desktop-release-state-writer \(77\)/)
  const state = await fixture.readState()
  assert.deepEqual(state.calls.map(call => call.method), ["GET", "POST", "GET", "GET"])
  assert.deepEqual(state.calls[1].body, releaseStateWriterRuleset(fixtureAppId))
  assert.equal(state.calls.at(-1).endpoint, "repos/" + fixtureRepository + "/rulesets/77?includes_parents=true")
})

async function makeGhFixture(t, initialState) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "elef-release-ruleset-cli-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bin = path.join(directory, "bin")
  const ghPath = path.join(bin, "gh")
  const statePath = path.join(directory, "state.json")
  await mkdir(bin)
  await writeFile(ghPath, fakeGhProgram)
  await chmod(ghPath, 0o755)
  await writeFile(statePath, JSON.stringify(initialState))
  return {
    env: {
      ...process.env,
      FAKE_GH_STATE: statePath,
      GITHUB_REPOSITORY: fixtureRepository,
      PATH: bin + ":" + process.env.PATH
    },
    readState: async () => JSON.parse(await readFile(statePath, "utf8"))
  }
}

function runSetup(fixture, args) {
  return spawnSync(process.execPath, [configureScript, String(fixtureAppId), ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: fixture.env
  })
}
