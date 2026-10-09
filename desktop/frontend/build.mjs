import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(frontendRoot, "../..")
const sharedFrontendRoot = path.join(repoRoot, "app/javascript")
const e2eBuild = process.env.ELEF_E2E_BUILD === "1"
const output = path.join(frontendRoot, e2eBuild ? "dist-e2e" : "dist")
const assets = path.join(output, "assets")
const sharedModuleAliases = {
  "#elef/preview-sanitizer": "lib/preview_sanitizer.js"
}

await rm(output, { recursive: true, force: true })
await mkdir(assets, { recursive: true })
const appSourceAlias = {
  name: "app-source-alias",
  setup(context) {
    context.onResolve({ filter: /^#elef\// }, ({ path: importPath }) => {
      const sharedModule = sharedModuleAliases[importPath]
      if (!sharedModule) return
      return { path: path.join(sharedFrontendRoot, sharedModule) }
    })
    context.onResolve({ filter: /^(?:controllers|lib)\// }, ({ path: importPath }) => ({
      path: path.join(sharedFrontendRoot, `${importPath}.js`)
    }))
    context.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData?.desktopSharedDependencyResolution) return
      // Monorepo packages are first-party source, not declared dependencies:
      // resolve the package barrel directly so Rails and desktop share one copy.
      const workspaceMatch = /^@elef\/([^/]+)(\/[^/]+)?$/.exec(args.path)
      if (workspaceMatch) {
        // The client ships a committed self-contained dist (React included)
        // that both hosts consume byte-identically, following the renderer
        // precedent; the desktop never re-bundles client source. The deferred
        // preview renderer ships the same way as its own committed file.
        if (workspaceMatch[1] === "client" && !workspaceMatch[2]) {
          return { path: path.join(repoRoot, "packages", "client", "dist", "elef-client.js") }
        }
        if (workspaceMatch[1] === "client" && workspaceMatch[2] === "/preview-core") {
          return { path: path.join(repoRoot, "packages", "client", "dist", "preview-core.js") }
        }
        const manifest = JSON.parse(await readFile(path.join(repoRoot, "packages", workspaceMatch[1], "package.json"), "utf8"))
        const subpath = workspaceMatch[2] ? `.${workspaceMatch[2]}` : "."
        const exported = manifest.exports?.[subpath]
        const entry = typeof exported === "string" ? exported : exported?.default
        if (!entry) throw new Error(`Workspace package @elef/${workspaceMatch[1]} has no export ${subpath}.`)
        return { path: path.join(repoRoot, "packages", workspaceMatch[1], entry) }
      }
      const relativeImporter = path.relative(sharedFrontendRoot, args.importer)
      const relativePackageImporter = path.relative(path.join(repoRoot, "packages"), args.importer)
      const sharedImporter = !(relativeImporter.startsWith("..") || path.isAbsolute(relativeImporter))
        || !(relativePackageImporter.startsWith("..") || path.isAbsolute(relativePackageImporter))
      if (!sharedImporter) return
      if (args.path.startsWith("controllers/") || args.path.startsWith("lib/")) return

      const result = await context.resolve(args.path, {
        resolveDir: frontendRoot,
        kind: args.kind,
        pluginData: { desktopSharedDependencyResolution: true }
      })
      if (result.errors.length) {
        const details = result.errors.map((error) => error.text).join("\n")
        throw new Error(`Rails-owned frontend dependency ${args.path} is unavailable to the desktop build:\n${details}`)
      }
      const resolved = result.path
      const relativeDependency = path.relative(path.join(frontendRoot, "node_modules"), resolved)
      if (relativeDependency.startsWith("..") || path.isAbsolute(relativeDependency)) {
        throw new Error(`Rails-owned frontend dependency ${args.path} must be declared by desktop/frontend/package.json.`)
      }
      return { path: resolved }
    })
  }
}
const frontendResult = await build({
  entryPoints: [path.join(frontendRoot, "src/main.js")],
  nodePaths: [path.join(frontendRoot, "node_modules")],
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  outdir: assets,
  entryNames: "app",
  chunkNames: "chunks/[name]-[hash]",
  minify: true,
  metafile: true,
  define: { __ELEF_E2E__: JSON.stringify(e2eBuild) },
  plugins: [appSourceAlias]
})

// CodeMirror extensions use instanceof checks across package boundaries. A second
// copy of one of these packages makes extensions created by the Rails-owned
// controllers incompatible with the editor instance created by the desktop.
const runtimeIdentityPackages = new Set([
  ...Object.keys(frontendResult.metafile.inputs)
    .flatMap((input) => [...input.matchAll(/node_modules\/(?:(@[^/]+\/[^/]+)|([^/]+))\//g)])
    .map((match) => match[1] || match[2])
    .filter((name) => name.startsWith("@codemirror/") || name.startsWith("@lezer/")),
  "@hotwired/stimulus",
  "@marijn/find-cluster-break",
  "@replit/codemirror-vim",
  "@replit/codemirror-vim-core",
  "codemirror",
  "crelt",
  "style-mod",
  "w3c-keyname"
])
const packageInstallations = new Map()
for (const input of Object.keys(frontendResult.metafile.inputs)) {
  for (const packageName of runtimeIdentityPackages) {
    const marker = `node_modules/${packageName}/`
    const packageIndex = input.lastIndexOf(marker)
    if (packageIndex < 0) continue
    const installation = input.slice(0, packageIndex + marker.length - 1)
    if (!packageInstallations.has(packageName)) packageInstallations.set(packageName, new Set())
    packageInstallations.get(packageName).add(installation)
  }
}
const duplicates = [...packageInstallations]
  .filter(([, installations]) => installations.size > 1)
  .map(([packageName, installations]) => `${packageName}: ${[...installations].join(", ")}`)
if (duplicates.length) {
  throw new Error(`Desktop bundle contains duplicate runtime identity packages:\n${duplicates.join("\n")}`)
}
// Rails owns and builds the renderer. Desktop packages the exact same artifact.
const rendererBundle = path.join(repoRoot, "vendor/javascript/elef-renderer.bundle.js")
await copyFile(rendererBundle, path.join(assets, "renderer.bundle.js"))
await build({
  entryPoints: [path.join(frontendRoot, "src/renderer-worker.js")],
  nodePaths: [path.join(frontendRoot, "node_modules")],
  bundle: true,
  external: ["./renderer.bundle.js"],
  format: "esm",
  target: "es2022",
  outfile: path.join(assets, "renderer-worker.js"),
  minify: true,
  plugins: [appSourceAlias]
})

const desktopHost = await readFile(path.join(repoRoot, "app/views/desktop_host.html"), "utf8")
// The authoring dialog renders through the shared client now (same DOM
// contract the web pages use), so the host ships a mount point instead of
// inlining server-rendered dialog markup.
const indexHtml = desktopHost
if (!indexHtml.includes('id="authoring-settings-mount"')) {
  throw new Error("The desktop host must provide the shared authoring dialog mount point.")
}
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
await copyFile(path.join(repoRoot, "app/assets/stylesheets/file_library_host.css"), path.join(assets, "file_library_host.css"))
await copyFile(path.join(repoRoot, "app/assets/builds/tailwind.css"), path.join(assets, "tailwind.css"))
await copyFile(path.join(frontendRoot, "node_modules/katex/dist/katex.min.css"), path.join(assets, "katex.min.css"))
await cp(path.join(frontendRoot, "node_modules/katex/dist/fonts"), path.join(assets, "fonts"), { recursive: true })
await copyFile(path.join(repoRoot, "vendor/javascript/mermaid.min.js"), path.join(assets, "mermaid.min.js"))
