import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(frontendRoot, "../..")
const output = path.join(frontendRoot, "dist")
const assets = path.join(output, "assets")

await mkdir(assets, { recursive: true })
await build({
  entryPoints: [path.join(frontendRoot, "src/main.js")],
  nodePaths: [path.join(frontendRoot, "node_modules")],
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: assets,
  entryNames: "app",
  minify: true,
  plugins: [{
    name: "rails-controller-alias",
    setup(context) {
      context.onResolve({ filter: /^controllers\// }, ({ path: importPath }) => ({
        path: path.join(repoRoot, "app/javascript", `${importPath}.js`)
      }))
    }
  }]
})

await build({
  entryPoints: [path.join(frontendRoot, "src/renderer-worker.js")],
  nodePaths: [path.join(frontendRoot, "node_modules")],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: path.join(assets, "renderer-worker.js"),
  minify: true
})

const railsRendererBundle = path.join(repoRoot, "vendor/javascript/elef-renderer.bundle.js")
await build({
  entryPoints: [path.join(frontendRoot, "src/renderer-global.js")],
  nodePaths: [path.join(frontendRoot, "node_modules")],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: railsRendererBundle,
  minify: true,
  legalComments: "none"
})

// Keep Highlight.js's PHP whitespace template semantically intact without
// emitting a physical tab at end-of-line in the checked-in bundle.
const rendererBundle = await readFile(railsRendererBundle, "utf8")
const rawWhitespace = "[ \t\n"
const occurrences = rendererBundle.split(rawWhitespace).length - 1
if (occurrences !== 1) throw new Error(`Expected one Highlight.js whitespace template, found ${occurrences}.`)
await writeFile(railsRendererBundle, rendererBundle.replace(rawWhitespace, "[ \\t\n"))

await copyFile(path.join(frontendRoot, "index.html"), path.join(output, "index.html"))
await copyFile(path.join(frontendRoot, "theme.css"), path.join(assets, "theme.css"))
await copyFile(path.join(frontendRoot, "styles.css"), path.join(assets, "styles.css"))
await copyFile(path.join(frontendRoot, "node_modules/katex/dist/katex.min.css"), path.join(assets, "katex.min.css"))
await cp(path.join(frontendRoot, "node_modules/katex/dist/fonts"), path.join(assets, "fonts"), { recursive: true })
await copyFile(path.join(repoRoot, "vendor/javascript/mermaid.min.js"), path.join(assets, "mermaid.min.js"))
