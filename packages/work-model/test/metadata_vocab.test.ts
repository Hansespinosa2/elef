import assert from "node:assert/strict"
import test from "node:test"
import {
  MARGIN_SETTING_KEYS,
  METADATA_BOOLEAN_VALUES,
  METADATA_TOP_LEVEL_KEYS,
  THEME_VALUES,
  TYPOGRAPHY_VALUES,
  metadataValueChoices,
  normalizeThemeValue,
  normalizeTypographyValue,
  readStyle
} from "../src/index.js"

test("metadata vocabulary matches the parser's accepted values", () => {
  // Value lists derive from the same Sets the parser reads: every suggested
  // value normalizes to itself, and every parser default is suggested.
  for (const value of THEME_VALUES) assert.equal(normalizeThemeValue(value), value)
  for (const value of TYPOGRAPHY_VALUES) assert.equal(normalizeTypographyValue(value), value)
  assert.equal(normalizeThemeValue(""), readStyle("").theme)
  assert.equal(normalizeTypographyValue(""), readStyle("").typography)
  assert.ok(THEME_VALUES.includes(readStyle("").theme))
  assert.ok(TYPOGRAPHY_VALUES.includes(readStyle("").typography))
})

test("metadata keys cover the user-facing front matter fields", () => {
  assert.deepEqual([...METADATA_TOP_LEVEL_KEYS].sort(), ["show-in-margin", "theme", "typography"])
  for (const key of ["section", "subsection", "footnote"]) {
    assert.ok((MARGIN_SETTING_KEYS as readonly string[]).includes(key))
  }
  assert.ok((MARGIN_SETTING_KEYS as readonly string[]).includes("slide-count"))
  assert.ok((MARGIN_SETTING_KEYS as readonly string[]).includes("slide_count"))
})

test("metadata value choices follow the existing vocabularies", () => {
  assert.deepEqual([...(metadataValueChoices("theme") ?? [])].sort(), [...THEME_VALUES].sort())
  assert.deepEqual([...(metadataValueChoices("typography") ?? [])].sort(), [...TYPOGRAPHY_VALUES].sort())
  for (const key of ["section", "subsection", "footnote", "slide-count", "slide_count"]) {
    assert.deepEqual(metadataValueChoices(key), METADATA_BOOLEAN_VALUES)
  }
  assert.equal(metadataValueChoices("show-in-margin"), null)
  assert.equal(metadataValueChoices("unknown-key"), null)
  assert.equal(metadataValueChoices("elef_document_key"), null)
})
