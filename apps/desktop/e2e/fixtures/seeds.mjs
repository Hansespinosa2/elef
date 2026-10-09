// Single source for the shared e2e seed contents consumed by both runners:
// run.mjs (CI flow: desktop library + Rails fixtures) and seed-web-fixtures.mjs
// (local `bin/check all` flow: Rails fixtures for the web runner). The hostile
// payload must stay identical everywhere so the shared hostile-deck scenario
// asserts the same neutralization on both hosts.
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const fixturesRoot = path.dirname(fileURLToPath(import.meta.url))

export const hostileSource = await readFile(path.join(fixturesRoot, "hostile-source.md"), "utf8")
export const e2eDocumentSource = "---\ntheme: dark\n---\n# E2E document\n\nSee [[E2E linked]].\n"
export const e2eLinkedDocumentSource = "---\ntheme: light\n---\n# E2E linked\n\nTarget document.\n"
