import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { presentConflictDialog } from "../../../app/javascript/lib/conflict_dialog.js"

test("shared conflict presentation fills host markup with text and preserves its native dialog state", () => {
  const { document } = parseHTML(`
    <dialog id="conflict-dialog">
      <p id="conflict-message"></p>
      <pre id="conflict-local"></pre>
      <pre id="conflict-disk"></pre>
      <span id="conflict-source-name"></span>
      <textarea id="conflict-merge"></textarea>
    </dialog>
  `)
  const dialog = document.querySelector("dialog")
  dialog.open = false
  dialog.showModal = () => { dialog.open = true }

  assert.equal(presentConflictDialog(dialog, {
    message: "Current <version>",
    localSource: "<script>local()</script>",
    diskSource: "disk & source",
    diskSourceFile: "presentation.md",
    mergeSource: "local draft"
  }), true)

  assert.equal(dialog.open, true)
  assert.equal(dialog.querySelector("#conflict-message").textContent, "Current <version>")
  assert.equal(dialog.querySelector("#conflict-local").textContent, "<script>local()</script>")
  assert.equal(dialog.querySelector("#conflict-local").querySelector("script"), null)
  assert.equal(dialog.querySelector("#conflict-disk").textContent, "disk & source")
  assert.equal(dialog.querySelector("#conflict-source-name").textContent, "presentation.md")
  assert.equal(dialog.querySelector("#conflict-merge").value, "local draft")

  assert.equal(presentConflictDialog(null), false)
})
