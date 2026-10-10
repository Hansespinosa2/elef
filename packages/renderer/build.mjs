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

// Shipped IIFE bundle (MiniRacer, workers, importmap): bare projection
// composed with editor chrome. Same esbuild surface as the former host-owned
// renderer build script; only the entry and output moved home.
const output = path.join(dist, "elef-renderer.bundle.js")
await build({
  entryPoints: [path.join(packageRoot, "src/renderer_global.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: output,
  minify: true,
  legalComments: "none"
})

// Keep Highlight.js's PHP whitespace template semantically intact without
// emitting a physical tab at end-of-line in the checked-in bundle.
const bundle = await readFile(output, "utf8")
const rawWhitespace = "[ \t\n"
const occurrences = bundle.split(rawWhitespace).length - 1
if (occurrences !== 1) throw new Error(`Expected one Highlight.js whitespace template, found ${occurrences}.`)
await writeFile(output, bundle.replace(rawWhitespace, "[ \\t\n"))

console.log("packages/renderer: dist/elef-renderer.js + dist/elef-renderer.bundle.js built")
