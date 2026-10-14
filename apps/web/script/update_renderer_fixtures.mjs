import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

// Explicit maintenance command. Tests never regenerate their expectations.
const inputsPath = new URL("../test/javascript/fixtures/renderer-inputs.json", import.meta.url)
const outputsPath = new URL("../test/javascript/fixtures/renderer-outputs.json", import.meta.url)
const bundlePath = new URL("../../../packages/renderer/dist/elef-renderer.bundle.js", import.meta.url)
const sandbox = vm.createContext({})
vm.runInContext(await readFile(bundlePath, "utf8"), sandbox, { filename: fileURLToPath(bundlePath) })
const renderer = sandbox.ElefRenderer
const inputs = JSON.parse(await readFile(inputsPath, "utf8"))
const outputs = inputs.map(({ name, input }) => ({
  name,
  blockHtml: renderer.renderMarkdownBlock(input.source, {
    mediaMap: input.mediaMap || {},
    allowRemoteMedia: input.allowRemoteMedia === true
  }),
  preview: renderer.renderPreview(input)
}))
await writeFile(outputsPath, JSON.stringify(outputs, null, 2) + "\n")
console.log(`Wrote ${outputs.length} renderer fixtures. Review the output diff before committing.`)
