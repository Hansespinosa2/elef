import { copyFile, cp, mkdir } from "node:fs/promises"
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

await copyFile(path.join(frontendRoot, "index.html"), path.join(output, "index.html"))
await copyFile(path.join(frontendRoot, "theme.css"), path.join(assets, "theme.css"))
await copyFile(path.join(frontendRoot, "styles.css"), path.join(assets, "styles.css"))
await copyFile(path.join(frontendRoot, "node_modules/katex/dist/katex.min.css"), path.join(assets, "katex.min.css"))
await cp(path.join(frontendRoot, "node_modules/katex/dist/fonts"), path.join(assets, "fonts"), { recursive: true })
await copyFile(path.join(repoRoot, "vendor/javascript/mermaid.min.js"), path.join(assets, "mermaid.min.js"))
