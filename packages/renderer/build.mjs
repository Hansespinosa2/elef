import { mkdir } from "node:fs/promises"
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

console.log("packages/renderer: dist/elef-renderer.js + dist/projection.js built (bare entries; the composed IIFE lives in packages/editor-runtime)")
