import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  CONFLICT_BASELINE_SOURCE,
  CONFLICT_DECK_NAME,
  CONFLICT_EXTERNAL_SOURCE,
  CONFLICT_LOCAL_SOURCE,
  CONFLICT_SOURCE_FILE
} from "../../test/e2e/scenarios/external-edit-conflict.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const manifestPath = path.join(repoRoot, "desktop/release-test-manifest.json")
const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
const requiredIds = [
  "basic_document",
  "basic_presentation",
  "rich_rendering_media",
  "historical_file_format",
  "unknown_directives",
  "pre_release_app_state",
  "dirty_save_conflict",
  "n_minus_1_n_package_pair",
  "redaction_sentinels"
]
const requiredCheckIds = [
  "manifest_integrity",
  "source_storage_fixture_round_trip",
  "full_web_desktop_parity",
  "packaged_n_minus_1_to_n_update",
  "arch_native_package_install_upgrade",
  "diagnostics_privacy"
]

assert.equal(manifest.schema_version, 1, "unsupported release fixture manifest schema")
assert.equal(manifest.status, "IN_PROGRESS", "fixture coverage is not complete until runtime acceptance passes")
assert.equal(manifest.validation.command, "npm run check:release-fixtures")
assert.equal(manifest.validation.expected_exit_code, 0)
assert.ok(manifest.validation.observed_exit_code === null || Number.isInteger(manifest.validation.observed_exit_code))
assert.deepEqual(manifest.fixtures.map(fixture => fixture.id), requiredIds, "required release fixtures must be named exactly once and in order")
assert.deepEqual(manifest.checks.map(check => check.id), requiredCheckIds, "required fixture acceptance checks must be named exactly once and in order")
assert.equal(manifest.package_pair_generator.command, "node desktop/e2e/build-update-fixtures.mjs")
assert.equal(manifest.package_pair_generator.expected_exit_code, 0, "package-pair generation must expect success")
assert.ok(manifest.package_pair_generator.observed_exit_code === null || Number.isInteger(manifest.package_pair_generator.observed_exit_code), "package-pair generation observed exit code must be null or an integer")
assert.ok(["TODO", "IN_PROGRESS", "VERIFIED"].includes(manifest.package_pair_generator.status), "package-pair generator has an invalid status")
if (manifest.package_pair_generator.status === "VERIFIED") {
  assert.equal(manifest.package_pair_generator.observed_exit_code, manifest.package_pair_generator.expected_exit_code, "package-pair generation cannot be VERIFIED without a passing result")
}
await assertRepoFile("desktop/e2e/build-update-fixtures.mjs")

for (const check of manifest.checks) {
  assert.ok(typeof check.command === "string" && check.command.length > 0, `${check.id} must name its exact command`)
  assert.equal(check.expected_exit_code, 0, `${check.id} must expect a passing result`)
  assert.ok(check.observed_exit_code === null || Number.isInteger(check.observed_exit_code), `${check.id} observed exit code must be null or an integer`)
  assert.ok(["TODO", "IN_PROGRESS", "VERIFIED"].includes(check.status), `${check.id} has an invalid status`)
  if (check.status === "VERIFIED") assert.equal(check.observed_exit_code, check.expected_exit_code, `${check.id} cannot be VERIFIED without its expected exit status`)
  for (const fixtureId of check.covers || []) assert.ok(requiredIds.includes(fixtureId), `${check.id} references unknown fixture ${fixtureId}`)
}

for (const fixture of manifest.fixtures) {
  assert.ok(Array.isArray(fixture.paths) && fixture.paths.length > 0, `${fixture.id} must name its fixture paths`)
  assert.equal(fixture.expected_exit_code, 0, `${fixture.id} must expect a passing acceptance command`)
  assert.ok(typeof fixture.acceptance_command === "string" && fixture.acceptance_command.length > 0, `${fixture.id} must name an exact acceptance command`)
  assert.ok(fixture.observed_exit_code === null || Number.isInteger(fixture.observed_exit_code), `${fixture.id} observed exit code must be null or an integer`)
  assert.ok(["TODO", "IN_PROGRESS", "VERIFIED"].includes(fixture.status), `${fixture.id} has an invalid status`)
  if (fixture.status === "VERIFIED") assert.equal(fixture.observed_exit_code, fixture.expected_exit_code, `${fixture.id} cannot be VERIFIED without its expected exit status`)
  assert.ok(Array.isArray(fixture.invariants) && fixture.invariants.length > 0, `${fixture.id} must name expected invariants`)

  if (fixture.generated_by) {
    assert.equal(fixture.generated_by, "package_pair_generator", `${fixture.id} names an unknown generator`)
    for (const generatedPath of fixture.paths) {
      assert.ok(manifest.package_pair_generator.generated_paths.includes(generatedPath), `${fixture.id} path is absent from its generator record: ${generatedPath}`)
    }
  } else {
    for (const fixturePath of fixture.paths) await assertRepoFile(fixturePath)
  }
}

const fixtureMap = new Map(manifest.fixtures.map(fixture => [fixture.id, fixture]))
const basicDocument = await readFixtureText("basic_document")
const basicPresentation = await readFixtureText("basic_presentation")
const richSample = await readFixtureText("rich_rendering_media")
const unknownSource = await readFixtureText("unknown_directives")
assert.match(basicDocument, /^---\ntheme: dark\n---\n/m)
assert.match(basicPresentation, /^# Before E2E$/m)
assert.match(richSample, /^theme: dark$/m)
assert.match(richSample, /```mermaid\n/)
assert.match(richSample, /^:::art$/m)
assert.match(richSample, /images\/release-pixel\.png/)
assert.deepEqual((await readFile(resolveFixturePath("rich_rendering_media", 1))).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
assert.match(unknownSource, /\[\[Future Release Notes\]\]/)
assert.match(unknownSource, /^:::future-directive/m)

const historicalPath = resolveFixturePath("historical_file_format", 0)
await assert.rejects(stat(path.join(path.dirname(historicalPath), "elef.json")), { code: "ENOENT" }, "historical sample must remain a pre-manifest deck")
const appState = await readFixtureText("pre_release_app_state", 0)
assert.match(appState, /\$\{ELEF_RELEASE_FIXTURE_LIBRARY_ROOT\}/)
assert.ok(fixtureMap.get("pre_release_app_state").path_substitutions["${ELEF_RELEASE_FIXTURE_LIBRARY_ROOT}"])

const conflict = JSON.parse(await readFixtureText("dirty_save_conflict"))
assert.equal(conflict.deck, CONFLICT_DECK_NAME, "the shared conflict scenario must consume the manifested deck fixture")
assert.equal(conflict.source_file, CONFLICT_SOURCE_FILE, "the shared conflict scenario must consume the manifested source filename")
assert.equal(conflict.baseline_source, CONFLICT_BASELINE_SOURCE, "the shared conflict scenario must consume the manifested baseline")
assert.equal(conflict.dirty_source, CONFLICT_LOCAL_SOURCE, "the shared conflict scenario must consume the manifested dirty source")
assert.equal(conflict.external_source, CONFLICT_EXTERNAL_SOURCE, "the shared conflict scenario must consume the manifested external source")
assert.notEqual(conflict.baseline_source, conflict.dirty_source)
assert.notEqual(conflict.baseline_source, conflict.external_source)
assert.match(conflict.invariant, /must not overwrite/i)

const sentinels = JSON.parse(await readFixtureText("redaction_sentinels"))
const sentinelValues = Object.values(sentinels)
assert.equal(new Set(sentinelValues).size, sentinelValues.length, "redaction sentinels must all be distinct")
assert.ok(sentinelValues.length >= 8, "redaction fixture must cover all sensitive input categories")

assert.ok(manifest.environment_notes.some(note => note.includes("port 3000")), "manifest must preserve the live-server safety constraint")
assert.ok(manifest.environment_notes.some(note => note.includes("Null observed exit codes")), "manifest must distinguish plans from executed evidence")
const pending = manifest.fixtures.filter(fixture => fixture.status !== "VERIFIED").length
process.stdout.write(`Release fixture manifest is structurally valid: ${manifest.fixtures.length} required fixtures, ${pending} acceptance scenarios pending.\n`)

async function assertRepoFile(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath)
  assert.ok(absolutePath.startsWith(`${repoRoot}${path.sep}`), `fixture path escapes the repository: ${relativePath}`)
  const metadata = await stat(absolutePath)
  assert.ok(metadata.isFile(), `fixture path is not a file: ${relativePath}`)
  return absolutePath
}

function resolveFixturePath(id, index = 0) {
  const fixture = fixtureMap.get(id)
  assert.ok(fixture, `missing fixture ${id}`)
  return path.resolve(repoRoot, fixture.paths[index])
}

async function readFixtureText(id, index = 0) {
  return readFile(resolveFixturePath(id, index), "utf8")
}
