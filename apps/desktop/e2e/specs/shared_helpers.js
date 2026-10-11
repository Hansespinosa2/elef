// Shared Playwright spec helpers: the deferred preview renderer and the
// Rails-owned layered application stylesheet, resolved exactly as the
// served pages compose them. Used by web.spec.js and components.spec.js.
import { readFile } from "node:fs/promises"
import { renderPreviewCore } from "@elef/renderer"
import { editorChrome } from "@elef/editor-runtime/editor-chrome"

export const renderPreview = input => renderPreviewCore(input, { chrome: editorChrome })

export async function readApplicationStylesheet() {
  const index = await readFile(new URL("../../../web/app/assets/stylesheets/application.css", import.meta.url), "utf8")
  const layerOrder = index.match(/^\s*@layer [^;]+;/m)?.[0]
  const imports = [...index.matchAll(/^\s*@import url\("\.\/([^"\n]+\.css)"\) layer\(([^)]+)\);\s*$/gm)]
  const partials = await Promise.all(imports.map(([, stylesheet]) =>
    readFile(new URL(`../../../web/app/assets/stylesheets/${stylesheet}`, import.meta.url), "utf8")
  ))

  if (!layerOrder || imports.length === 0) throw new Error("Could not resolve the layered application stylesheet")

  return [
    layerOrder,
    ...imports.map(([, , layer], index) => `@layer ${layer} {\n${partials[index]}\n}`)
  ].join("\n")
}

export async function readHostStylesheets() {
  const applicationStylesheet = await readApplicationStylesheet()
  const tailwind = await readFile(new URL("../../../web/app/assets/builds/tailwind.css", import.meta.url), "utf8")
  return {
    web: `${tailwind}\n${applicationStylesheet}`,
    desktop: (await readFile(new URL("../../../web/app/assets/stylesheets/file_library_host.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../frontend/dist/assets/tailwind.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../frontend/dist/assets/app.css", import.meta.url), "utf8"))
  }
}
