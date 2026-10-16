// Local web-e2e entry point used by `bin/check all`. Mirrors the CI seeding in
// run.mjs (same records, same sources from ./fixtures/seeds.mjs) and then runs
// the Playwright web project against a disposable test server. run.mjs keeps
// its own CI seeding; the shared seed contents stay identical through the
// fixture module, never by copying.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SHARED_LIBRARY_CREATE_DELETE_TITLES } from "../../../apps/web/test/e2e/scenarios/library-create-delete.js"
import { e2eDocumentSource, e2eLinkedDocumentSource, hostileSource } from "./fixtures/seeds.mjs"

const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../../..")
const webRoot = path.join(repoRoot, "apps", "web")

const seedCode = [
  `Presentation.where(title: ${JSON.stringify(SHARED_LIBRARY_CREATE_DELETE_TITLES.presentation)}).destroy_all`,
  `Document.where(title: ${JSON.stringify(SHARED_LIBRARY_CREATE_DELETE_TITLES.document)}).destroy_all`,
  // Local reruns share one sqlite file (and `bin/check all` runs twice per
  // invariant 15), so the seeder removes its own fixed titles first; CI
  // instead tears down by id after the run.
  `Presentation.where(title: ["E2E seed", "E2E conflict", "E2E hostile"]).destroy_all`,
  `Document.where(title: ["E2E document", "E2E linked"]).destroy_all`,
  `presentation = Presentation.create!(title: "E2E seed", source: "# Before E2E\\n\\nSeed paragraph.\\n\\nSee [[E2E linked]].\\n")`,
  `conflict = Presentation.create!(title: "E2E conflict", source: "# Before conflict test\\n\\nSeed paragraph.\\n")`,
  `hostile = Presentation.create!(title: "E2E hostile", source: ${JSON.stringify(hostileSource)})`,
  `document = Document.create!(source: ${JSON.stringify(e2eDocumentSource)})`,
  `linked = Document.create!(source: ${JSON.stringify(e2eLinkedDocumentSource)})`,
  `puts "ELEF_E2E_PRESENTATION_ID=#{presentation.id}"`,
  `puts "ELEF_E2E_CONFLICT_PRESENTATION_ID=#{conflict.id}"`,
  `puts "ELEF_E2E_HOSTILE_PRESENTATION_ID=#{hostile.id}"`,
  `puts "ELEF_E2E_DOCUMENT_IDS=#{[document.id, linked.id].join(',')}"`,
].join("; ")

const seeded = execFileSync("bin/rails", ["runner", "-e", "test", seedCode], {
  cwd: webRoot,
  encoding: "utf8",
  env: { ...process.env, RAILS_ENV: "test", ELEF_USE_SQLITE: "1" },
})
const id = seeded.match(/^ELEF_E2E_PRESENTATION_ID=(\d+)$/m)?.[1]
assert.match(id, /^\d+$/, "Rails fixture command should return the presentation id")
const docs = seeded.match(/^ELEF_E2E_DOCUMENT_IDS=(\d+,\d+)$/m)?.[1]
assert.ok(docs, "Rails fixture command should return document IDs")
const [documentId, linkedDocumentId] = docs.split(",")

const playwright = path.join(e2eRoot, "node_modules", ".bin", "playwright")
const webResult = spawnSync(playwright, ["test", "--project=web"], {
  cwd: e2eRoot,
  env: {
    ...process.env,
    RAILS_ENV: "test",
    ELEF_USE_SQLITE: "1",
    ELEF_E2E_PRESENTATION_ID: id,
    ELEF_E2E_CONFLICT_PRESENTATION_ID: seeded.match(/^ELEF_E2E_CONFLICT_PRESENTATION_ID=(\d+)$/m)[1],
    ELEF_E2E_HOSTILE_PRESENTATION_ID: seeded.match(/^ELEF_E2E_HOSTILE_PRESENTATION_ID=(\d+)$/m)[1],
    ELEF_E2E_DOCUMENT_ID: documentId,
    ELEF_E2E_LINKED_DOCUMENT_ID: linkedDocumentId,
    ELEF_E2E_WEB_URL: "http://127.0.0.1:3000",
    ELEF_E2E_START_WEB_SERVER: "1",
  },
  stdio: "inherit",
})
if (webResult.error) throw webResult.error
if (webResult.status !== 0) throw new Error(`Shared web scenarios failed with status ${webResult.status}`)
