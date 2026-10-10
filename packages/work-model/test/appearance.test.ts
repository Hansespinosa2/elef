import assert from "node:assert/strict"
import test from "node:test"
import { readStyle, withAppearanceValue } from "../src/index.js"

test("appearance writes preserve unrelated metadata, body bytes, Unicode, and line endings", () => {
  for (const eol of ["\n", "\r\n", "\r"]) {
    const source = ["---", "author: Café 😀", "theme: light # override", "show-in-margin:", "  section: false", "---", "# Title", "", "Body with a --- separator", ""].join(eol)
    const themed = withAppearanceValue(source, "theme", "dark")
    assert.equal(themed, source.replace("theme: light # override", "theme: dark"))
    const styled = withAppearanceValue(themed, "typography", "technical")
    assert.equal(styled, themed.replace(`${eol}---${eol}#`, `${eol}typography: technical${eol}---${eol}#`))
    assert.deepEqual(readStyle(styled), { theme: "dark", typography: "technical" })
    assert.equal(withAppearanceValue(styled, "typography", ""), themed)
  }
})

test("workspace defaults remove only the chosen override", () => {
  const body = "# Original\n\n---\nBody\n"
  const themed = withAppearanceValue(body, "theme", "dark")
  assert.equal(themed, "---\ntheme: dark\n---\n" + body)
  assert.equal(withAppearanceValue(themed, "theme", ""), body)
  assert.equal(withAppearanceValue(body, "theme", ""), body)
  const both = withAppearanceValue(themed, "typography", "technical")
  assert.equal(withAppearanceValue(both, "theme", ""), "---\ntypography: technical\n---\n" + body)
  assert.throws(() => withAppearanceValue(body, "author", "somebody"), TypeError)
  assert.throws(() => withAppearanceValue(body, "theme", "dark\nextra: value"), TypeError)
})
