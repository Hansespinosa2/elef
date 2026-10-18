import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { build } from "esbuild"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const dist = path.join(packageRoot, "dist")
await mkdir(dist, { recursive: true })

// Node-runtime API (package "." export): plain-node consumers (desktop e2e,
// web JS tests, the client bundler) cannot load .ts source.
await build({
  entryPoints: [path.join(packageRoot, "src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(dist, "elef-renderer.js"),
  minify: true,
  legalComments: "none"
})

// Bare ESM entry (export flows): plain structural wrappers with no editor
// chrome, for TypeScript consumers. Chrome composition lives in the
// editor-runtime-owned composed entry, never here.
await build({
  entryPoints: [path.join(packageRoot, "src/projection.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(dist, "projection.js"),
  minify: true,
  legalComments: "none"
})

// Keep Highlight.js's PHP whitespace template semantically intact without
// emitting a physical tab at end-of-line in the checked-in bundle.
const rawWhitespace = "[ \t\n"
for (const artifact of ["elef-renderer.js", "projection.js"]) {
  const artifactPath = path.join(dist, artifact)
  const bundle = await readFile(artifactPath, "utf8")
  const occurrences = bundle.split(rawWhitespace).length - 1
  if (occurrences !== 1) throw new Error(`Expected one Highlight.js whitespace template in ${artifact}, found ${occurrences}.`)
  await writeFile(artifactPath, bundle.replace(rawWhitespace, "[ \\t\n"))
}

console.log("packages/renderer: dist/elef-renderer.js + dist/projection.js built (bare entries; the composed IIFE lives in packages/editor-runtime)")
