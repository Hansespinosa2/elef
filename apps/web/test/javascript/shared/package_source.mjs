import { readFile } from "node:fs/promises"
import { transformSync } from "esbuild"

const repoRoot = new URL("../../../../../", import.meta.url)

// Load a TypeScript package module from source and transpile it in memory,
// so unit tests prove the current source correct instead of the last build.
// Bare and relative import specifiers survive the transpile verbatim (the
// same strings the per-file dist transpile emits), so each suite's existing
// stub surgery applies unchanged. Suites that must consume a shipped bundle
// entry stay on dist/ as the explicit smoke lane (see docs/development.md).
export async function loadPackageSource(pathFromRepoRoot) {
  const typescript = await readFile(new URL(pathFromRepoRoot, repoRoot), "utf8")
  return transformSync(typescript, { loader: "ts", format: "esm", target: "es2022" }).code
}
