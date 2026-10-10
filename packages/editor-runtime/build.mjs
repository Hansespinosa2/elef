// Canonical producer of the committed packages/editor-runtime/dist/ artifacts.
//
// Two shapes from one source:
// - The three package entries (index, preview_chrome, test_internals) ship
//   as SELF-CONTAINED bundles. Propshaft serves only digested URLs, so a
//   browser entry with relative imports 404s on every sibling (proven by
//   the Phase 12 system-test battery). Bare imports stay external: each is
//   an importmap pin served once and shared. Bundling a second Stimulus,
//   CodeMirror, or Elef package copy would split framework identity, so the
//   externals below mirror the pinned shared set (see config/importmap.rb
//   and the ownership checker's pin-coverage assertion).
// - Every other module ships as a per-file transpile for the node harnesses
//   under apps/web/test, which read single controller/lib files as text and
//   load them through data: URLs. Migrating those harnesses to the
//   test-internals entry would let dist shrink to the three bundles.
// The build fails closed when a bundled entry keeps a relative import.
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const esbuild = require("esbuild")

// Pinned shared singletons (exact specifiers shipped today plus root
// wildcards so a future subpath stays external instead of silently
// inlining a second copy). Mirrors R12's allowed bare roots.
const sharedExternals = [
  "@hotwired/stimulus",
  "@hotwired/stimulus/*",
  "@elef/client",
  "@elef/client/*",
  "@elef/work-model",
  "@elef/work-model/*",
  "codemirror",
  "codemirror/*",
  "@codemirror/*",
  "@lezer/highlight",
  "@lezer/highlight/*",
  "@replit/codemirror-vim",
  "@replit/codemirror-vim/*",
  "katex",
  "katex/*"
]

const shared = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: sharedExternals,
  logLevel: "warning"
}

// Browser entries are minified; the node-only test entry stays readable.
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "index.ts")],
  outfile: join(here, "dist", "index.js"),
  minify: true
})
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "preview_chrome.ts")],
  outfile: join(here, "dist", "preview_chrome.js"),
  minify: true
})
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "test_internals.ts")],
  outfile: join(here, "dist", "test_internals.js"),
  minify: false
})

for (const entry of ["index.js", "preview_chrome.js", "test_internals.js"]) {
  const output = readFileSync(join(here, "dist", entry), "utf8")
  if (/(?:from\s*|import\()\s*["']\.\.?\//.test(output)) {
    throw new Error(`packages/editor-runtime/dist/${entry} keeps a relative import; the browser cannot resolve it.`)
  }
}

function entries(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entries(full)
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) return [full]
    return []
  })
}

const bundled = new Set(["index.ts", "preview_chrome.ts", "test_internals.ts"].map((name) => join(here, "src", name)))
esbuild.buildSync({
  entryPoints: entries(join(here, "src")).filter((entry) => !bundled.has(entry)),
  outdir: join(here, "dist"),
  outbase: join(here, "src"),
  format: "esm",
  platform: "browser",
  target: "es2022",
  logLevel: "warning"
})
console.log("packages/editor-runtime: dist/ entries bundled + modules transpiled from src/")
