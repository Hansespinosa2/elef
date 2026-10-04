import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(frontendRoot, "../..")
const e2eBuild = process.env.ELEF_E2E_BUILD === "1"
const output = path.join(frontendRoot, e2eBuild ? "dist-e2e" : "dist")
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
  define: { __ELEF_E2E__: JSON.stringify(e2eBuild) },
  plugins: [{
    name: "app-source-alias",
    setup(context) {
      context.onResolve({ filter: /^(?:controllers|lib)\// }, ({ path: importPath }) => ({
        path: path.join(repoRoot, "app/javascript", `${importPath}.js`)
      }))
    }
  }]
})

// Rails owns and builds the renderer. Desktop packages the exact same artifact.
const rendererBundle = path.join(repoRoot, "vendor/javascript/elef-renderer.bundle.js")
await copyFile(rendererBundle, path.join(assets, "renderer.bundle.js"))
await copyFile(path.join(frontendRoot, "src/renderer-worker.js"), path.join(assets, "renderer-worker.js"))

const indexHtml = await readFile(path.join(repoRoot, "app/views/desktop_shell/index.html"), "utf8")
if (e2eBuild) {
  await build({
    entryPoints: [path.join(frontendRoot, "../e2e/wdio-init.js")],
    nodePaths: [path.join(frontendRoot, "../e2e/node_modules")],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: path.join(assets, "wdio-init.js"),
    minify: true
  })
  const appModule = '<script type="module" src="./assets/app.js"></script>'
  if (!indexHtml.includes(appModule)) throw new Error("Could not find the desktop app module tag in index.html.")
  await writeFile(
    path.join(output, "index.html"),
    indexHtml.replace(appModule, '<script type="module" src="./assets/wdio-init.js"></script>\n    ' + appModule)
  )
} else {
  await writeFile(path.join(output, "index.html"), indexHtml)
}
await copyFile(path.join(repoRoot, "app/assets/stylesheets/desktop_shell.css"), path.join(assets, "desktop_shell.css"))
await copyFile(path.join(repoRoot, "app/assets/builds/tailwind.css"), path.join(assets, "tailwind.css"))
await copyFile(path.join(frontendRoot, "node_modules/katex/dist/katex.min.css"), path.join(assets, "katex.min.css"))
await cp(path.join(frontendRoot, "node_modules/katex/dist/fonts"), path.join(assets, "fonts"), { recursive: true })
await copyFile(path.join(repoRoot, "vendor/javascript/mermaid.min.js"), path.join(assets, "mermaid.min.js"))
