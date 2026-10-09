import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { buildPreviewRequestBody } from "../../../app/javascript/lib/preview_request_body.js"

test("preview requests include only Rails preview attributes, not the full editor form", () => {
  const { document } = parseHTML(`<form>
    <textarea name="presentation[source]"></textarea>
    <input name="presentation[title]" value="Deck title">
    <select name="presentation[theme]"><option value="dark" selected>Dark</option></select>
    <select name="presentation[typography]"><option value="book" selected>Book</option></select>
    <input name="presentation[lock_version]" value="19">
    <input name="presentation[base_revision]" value="secret-token">
    ${Array.from({ length: 200 }, () => '<button type="button">Slide action</button>').join("")}
  </form>`)
  const form = document.querySelector("form")
  form.querySelector("textarea").value = "# Current source"

  const body = buildPreviewRequestBody([...form.querySelectorAll("input, select, textarea")])

  assert.deepEqual([...body.entries()], [
    ["presentation[source]", "# Current source"],
    ["presentation[title]", "Deck title"],
    ["presentation[theme]", "dark"],
    ["presentation[typography]", "book"]
  ])
})

test("document preview requests preserve the nested source and omit presentation-only fields", () => {
  const { document } = parseHTML('<form><textarea name="document[source]"></textarea></form>')
  const form = document.querySelector("form")
  form.querySelector("textarea").value = "# Notes"

  assert.deepEqual([...buildPreviewRequestBody([...form.querySelectorAll("input, select, textarea")]).entries()], [["document[source]", "# Notes"]])
})

test("preview requests omit disabled controls like native FormData", () => {
  const body = buildPreviewRequestBody([
    { name: "presentation[source]", value: "# Unavailable", disabled: true },
    { name: "presentation[title]", value: "Available", disabled: false }
  ])

  assert.deepEqual([...body.entries()], [["presentation[title]", "Available"]])
})
