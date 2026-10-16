import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseHTML } from "linkedom"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
globalThis.__presentationMounts = []
globalThis.__editActionsMounts = []
const clientStubUrl = `data:text/javascript;base64,${Buffer.from(`
export function mountPresentationEditor(form, options) {
  const editor = { form, options, destroyed: 0, destroy() { editor.destroyed += 1 } }
  const mounted = { editor, destroyed: 0, destroy() { mounted.destroyed += 1; editor.destroy() } }
  globalThis.__presentationMounts.push({ form, options, mounted })
  return mounted
}
`).toString("base64")}`
const source = (await readFile(path.join(root, "packages/editor-runtime/dist/lib/presentation_editor_host.js"), "utf8"))
  .replace(/^import \{[^}]*\} from "\.\.\/controllers\/editor_math\.js";?$/ms, "const createActiveMathSpan = () => null; const deRenderMath = () => null; const finishMathBeforeEnter = () => null")
  .replace(/^import \{[^}]*\} from "\.\.\/controllers\/editor_math\.js";?$/ms, "const handleMathClick = () => null; const handleMathKeydown = () => null; const syncActiveMath = () => null")
  .replace(/^import \{[^}]*\} from "\.\.\/controllers\/editor_markdown\.js";?$/ms, "const sourceOffsetForVisiblePosition = () => null")
  .replace(/^import \{[^}]*\} from "\.\.\/controllers\/editor_markdown\.js";?$/ms, "const markdownForVisibleText = () => null; const renderInlineMath = () => null")
  .replace(/^import \{[^}]*\} from "\.\/editor_controller_lookup\.js";?$/ms, "const asEditorSeam = (value) => value; const editorFor = () => null")
  .replace(/^import \{[^}]*\} from "\.\.\/controllers\/editor_caret\.js";?$/ms, "const moveCaretBetweenBlocks = () => null; const pointAtVisibleOffset = () => null; const removeEmptyBlockSource = () => null; const sourceOffsetForVisibleOffset = () => null; const visibleOffsetAtPoint = () => null; const visibleOffsetForSourceOffset = () => null")
  .replace(/^import \{[^}]*\} from "\.\/projection_editability\.js";?$/ms, "const setProjectionBlockEditable = () => null")
  .replace('import { mountPresentationEditor } from "@elef/client"', `import { mountPresentationEditor } from "${clientStubUrl}"`)
  .replace(/^import \{[^}]*\} from "\.\/edit_actions_host\.js";?$/ms, "const mountHostEditActions = (form, getEditor, host) => { const mount = { form, getEditor, host, disposed: 0, dispose() { mount.disposed += 1 } }; globalThis.__editActionsMounts.push(mount); return mount }")
const host = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("the presentation host mount wires the editor, deps, and Edit-actions menu", () => {
  const { document } = parseHTML("<html><body><form><div class=\"source-field\"></div></form></body></html>")
  const form = document.querySelector("form")

  const mounted = host.mountHostPresentationEditor(form)

  assert.equal(globalThis.__presentationMounts.length, 1)
  const mount = globalThis.__presentationMounts[0]
  assert.equal(mount.form, form)
  assert.equal(mount.options.sourceElement, form.querySelector(".source-field"))
  assert.equal(typeof mount.options.getEditor, "function")
  assert.equal(typeof mount.options.deps.moveCaretBetweenBlocks, "function")
  assert.equal(typeof mount.options.deps.setProjectionBlockEditable, "function")
  assert.equal(mounted.editor, mount.mounted.editor)

  assert.equal(globalThis.__editActionsMounts.length, 1)
  assert.equal(globalThis.__editActionsMounts[0].form, form)
  assert.equal(globalThis.__editActionsMounts[0].host, mount.mounted.editor)
  assert.equal(globalThis.__editActionsMounts[0].getEditor, mount.options.getEditor)

  mounted.destroy()
  assert.equal(globalThis.__editActionsMounts[0].disposed, 1)
  assert.equal(mount.mounted.destroyed, 1)
  assert.equal(mount.mounted.editor.destroyed, 1)
})
