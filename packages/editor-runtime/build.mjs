// Canonical producer of the committed packages/editor-runtime/dist/ artifacts.
//
// Two shapes from one source:
// - The four package entries (index, preview_chrome, test_internals,
//   worker) ship as SELF-CONTAINED bundles. Propshaft serves only digested
//   URLs, so a browser entry with relative imports 404s on every sibling
//   (proven by the Phase 12 system-test battery). Bare imports stay
//   external: each is an importmap pin served once and shared. Bundling a
//   second Stimulus, CodeMirror, or Elef package copy would split framework
//   identity, so the externals below mirror the pinned shared set (see
//   config/importmap.rb and the ownership checker's pin-coverage
//   assertion). The worker entry is DOM-free by construction: the desktop
//   renderer worker bundles it instead of the barrel, whose module-scope
//   DOM side effects cannot evaluate inside a Web Worker.
// - Every other module ships as a per-file transpile for the node harnesses
//   under apps/web/test, which read single controller/lib files as text and
//   load them through data: URLs. Migrating those harnesses to the
//   test-internals entry would let dist shrink to the four bundles.
// - The Stable desktop profile ships dist/index.stable.js, built from the
//   stable entry that omits the excluded slices. The Stable build aliases
//   the bare @elef/client and @elef/work-model specifiers to the Stable
//   dists of those packages and bundles them, so importing an excluded
//   export fails this build instead of shipping hidden code. Subpath
//   imports stay external (shared dists the desktop build resolves once).
// The build fails closed when a bundled entry keeps a relative import.
// Every bundle writes its metafile beside the output (gitignored); the
// Stable/Dev profile checker proves slice absence from the stable metafile.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
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
  metafile: true,
  logLevel: "warning"
}

async function bundle(entry, outfile, options = {}) {
  const result = await esbuild.build({ ...shared, ...options, entryPoints: [entry], outfile })
  writeFileSync(outfile.replace(/\.js$/, ".metafile.json"), `${JSON.stringify(result.metafile, null, 2)}\n`)
}

// Browser entries are minified; the node-only test entry stays readable.
await bundle(join(here, "src", "index.ts"), join(here, "dist", "index.js"), { minify: true })
await bundle(join(here, "src", "preview_chrome.ts"), join(here, "dist", "preview_chrome.js"), { minify: true })
await bundle(join(here, "src", "test_internals.ts"), join(here, "dist", "test_internals.js"), { minify: false })
await bundle(join(here, "src", "lib", "renderer_worker.ts"), join(here, "dist", "worker.js"), { minify: true })

// The Stable entry bundles the Stable client and work-model dists, so those
// packages must be built first; the plugins below resolve the bare
// specifiers to the Stable dist files, and esbuild fails the build when the
// Stable graph names an export the Stable dists do not have.
const stableClientDist = join(here, "..", "client", "dist", "elef-client.stable.js")
const stableWorkModelDist = join(here, "..", "work-model", "dist", "elef-work-model.stable.js")
for (const [dist, owner] of [[stableClientDist, "@elef/client"], [stableWorkModelDist, "@elef/work-model"]]) {
  if (!existsSync(dist)) {
    throw new Error(`Build ${owner} before the Stable editor-runtime entry (missing ${relative(join(here, "..", ".."), dist)}).`)
  }
}
const stableProfileAlias = {
  name: "stable-profile-alias",
  setup(context) {
    context.onResolve({ filter: /^@elef\/client$/ }, () => ({ path: stableClientDist }))
    context.onResolve({ filter: /^@elef\/work-model$/ }, () => ({ path: stableWorkModelDist }))
  }
}
await bundle(join(here, "src", "index.stable.ts"), join(here, "dist", "index.stable.js"), {
  minify: true,
  external: sharedExternals.filter(specifier => specifier !== "@elef/client" && specifier !== "@elef/work-model"),
  plugins: [stableProfileAlias]
})

// Editor-runtime-owned renderer composition (MiniRacer, workers,
// importmap): bare @elef/renderer projection composed with package-owned
// editor chrome. Self-contained IIFE (external: []) so MiniRacer can eval
// the file directly; same surface as the former renderer-owned entry, only
// the entry and output moved home. Excluded from the per-file transpile
// below (see `bundled`): the IIFE owns dist/composed_renderer.js.
const composedOutput = join(here, "dist", "composed_renderer.js")
const composedResult = await esbuild.build({
  entryPoints: [join(here, "src", "composed_renderer.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: composedOutput,
  minify: true,
  metafile: true,
  legalComments: "none",
  external: [],
  logLevel: "warning"
})
writeFileSync(composedOutput.replace(/\.js$/, ".metafile.json"), `${JSON.stringify(composedResult.metafile, null, 2)}\n`)

// Keep Highlight.js's PHP whitespace template semantically intact without
// emitting a physical tab at end-of-line in the checked-in bundle.
const composedBundle = readFileSync(composedOutput, "utf8")
const rawWhitespace = "[ \t\n"
const composedOccurrences = composedBundle.split(rawWhitespace).length - 1
if (composedOccurrences !== 1) throw new Error(`Expected one Highlight.js whitespace template, found ${composedOccurrences}.`)
writeFileSync(composedOutput, composedBundle.replace(rawWhitespace, "[ \\t\n"))

for (const entry of ["index.js", "preview_chrome.js", "test_internals.js", "worker.js"]) {
  const output = readFileSync(join(here, "dist", entry), "utf8")
  if (/(?:from\s*|import\()\s*["']\.\.?\//.test(output)) {
    throw new Error(`packages/editor-runtime/dist/${entry} keeps a relative import; the browser cannot resolve it.`)
  }
}
{
  // The Stable bundle inlines the Stable dists: a surviving bare import
  // would resolve to the full dists downstream and silently regain the
  // excluded slices.
  const stable = readFileSync(join(here, "dist", "index.stable.js"), "utf8")
  for (const specifier of ["@elef/client", "@elef/work-model"]) {
    const pattern = new RegExp(`(?:from\\s*|import\\()\\s*["']${specifier.replaceAll("/", "\\/")}["']`)
    if (pattern.test(stable)) {
      throw new Error(`packages/editor-runtime/dist/index.stable.js keeps a bare ${specifier} import; the Stable entry must bundle it.`)
    }
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

const bundled = new Set(
  ["index.ts", "index.stable.ts", "preview_chrome.ts", "test_internals.ts", "composed_renderer.ts"].map((name) => join(here, "src", name))
    .concat(join(here, "src", "lib", "renderer_worker.ts"))
)
await esbuild.build({
  entryPoints: entries(join(here, "src")).filter((entry) => !bundled.has(entry)),
  outdir: join(here, "dist"),
  outbase: join(here, "src"),
  format: "esm",
  platform: "browser",
  target: "es2022",
  logLevel: "warning"
})
console.log("packages/editor-runtime: dist/ entries bundled (including index.stable.js) + modules transpiled from src/")
