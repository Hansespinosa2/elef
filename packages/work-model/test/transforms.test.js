import test from "node:test"
import assert from "node:assert/strict"
import {
  normalizeThemeValue,
  normalizeTypographyValue,
  readStyleOverrides,
  replaceFirstHeading,
  sourceAnchorLines,
  withAppearanceValue,
  withFrontMatterValue
} from "../src/index.js"

test("style normalization keeps vocabulary values and falls back otherwise", () => {
  assert.equal(normalizeThemeValue("dark"), "dark")
  assert.equal(normalizeThemeValue("light"), "light")
  assert.equal(normalizeThemeValue("match"), "match")
  assert.equal(normalizeThemeValue("unknown"), "match")
  assert.equal(normalizeThemeValue("book"), "match")
  assert.equal(normalizeThemeValue(""), "match")
  assert.equal(normalizeTypographyValue("modern"), "modern")
  assert.equal(normalizeTypographyValue("technical"), "technical")
  assert.equal(normalizeTypographyValue("book"), "book")
  assert.equal(normalizeTypographyValue("dark"), "book")
  assert.equal(normalizeTypographyValue(""), "book")
})

test("style normalization strips quotes and whitespace-introduced comments", () => {
  assert.equal(normalizeThemeValue('"dark"'), "dark")
  assert.equal(normalizeThemeValue("'light'"), "light")
  assert.equal(normalizeThemeValue('"dark'), "match")
  assert.equal(normalizeThemeValue("dark # deck theme"), "dark")
  assert.equal(normalizeThemeValue('"dark" # deck theme'), "dark")
  assert.equal(normalizeThemeValue("  dark   \t# deck theme"), "dark")
  assert.equal(normalizeThemeValue("dark#x"), "match")
  assert.equal(normalizeTypographyValue("'modern' # body"), "modern")
  assert.equal(normalizeTypographyValue("modern#x"), "book")
})

test("style overrides report explicit valid values and null otherwise", () => {
  assert.deepEqual(readStyleOverrides("---\ntheme: dark\ntypography: modern\n---\n# T"), { theme: "dark", typography: "modern" })
  assert.deepEqual(readStyleOverrides("---\ntheme: unknown\n---\n# T"), { theme: null, typography: null })
  assert.deepEqual(readStyleOverrides("---\ntitle: A\n---\n# T"), { theme: null, typography: null })
  assert.deepEqual(readStyleOverrides("# T\n\ntheme: dark\n"), { theme: null, typography: null })
  assert.deepEqual(readStyleOverrides("---\ntheme: dark\ntheme: light\n---\n# T"), { theme: "dark", typography: null })
  assert.deepEqual(readStyleOverrides("---\ntheme: unknown\ntheme: dark\n---\n# T"), { theme: null, typography: null })
  assert.deepEqual(readStyleOverrides("---\ntheme: \"dark\" # x\n---\n# T"), { theme: "dark", typography: null })
  assert.deepEqual(readStyleOverrides("---\ntitle: theme: dark\n---\n# T"), { theme: null, typography: null })
  assert.deepEqual(readStyleOverrides("---\ntitle: A\n---\ntheme: dark\n"), { theme: null, typography: null })
  assert.deepEqual(readStyleOverrides("---\r\ntheme: dark\r\n---\r\n# T"), { theme: "dark", typography: null })
  assert.deepEqual(readStyleOverrides("\uFEFF---\ntheme: dark\n---\n# T"), { theme: "dark", typography: null })
  assert.deepEqual(readStyleOverrides("---\n theme: dark\ntitle: x\n---\n# T"), { theme: null, typography: null })
})

test("front matter writes create, replace, and remove values", () => {
  assert.equal(withFrontMatterValue("# T\n", "theme", "dark"), "---\ntheme: dark\n---\n# T\n")
  assert.equal(
    withFrontMatterValue("---\ntitle: A\n---\n# T\n", "theme", "dark"),
    "---\ntitle: A\ntheme: dark\n---\n# T\n"
  )
  assert.equal(
    withFrontMatterValue("---\ntheme: light\ntitle: A\n---\n# T\n", "theme", "dark"),
    "---\ntheme: dark\ntitle: A\n---\n# T\n"
  )
  assert.equal(
    withFrontMatterValue("---\ntheme: light\ntitle: A\n---\n# T\n", "theme", null),
    "---\ntitle: A\n---\n# T\n"
  )
  assert.equal(
    withFrontMatterValue("---\ntheme: light\ntitle: A\n---\n# T\n", "theme", ""),
    "---\ntitle: A\n---\n# T\n"
  )
  assert.equal(
    withFrontMatterValue("---\ntheme: light\ntitle: A\n---\n# T\n", "theme", undefined),
    "---\ntitle: A\n---\n# T\n"
  )
})

test("front matter removal strips the last key and its empty block", () => {
  assert.equal(withFrontMatterValue("---\ntheme: light\n---\n# T\n", "theme", null), "# T\n")
  assert.equal(withFrontMatterValue("# T\n", "theme", null), "# T\n")
  assert.equal(withFrontMatterValue("---\ntitle: A\n---\n# T\n", "theme", null), "---\ntitle: A\n---\n# T\n")
})

test("front matter writes preserve the file line endings and match keys literally", () => {
  assert.equal(
    withFrontMatterValue("---\r\ntitle: A\r\n---\r\n# T\r\n", "theme", "dark"),
    "---\r\ntitle: A\r\ntheme: dark\r\n---\r\n# T\r\n"
  )
  assert.equal(
    withFrontMatterValue("---\rtheme: light\r---\r# T\r", "theme", "dark"),
    "---\rtheme: dark\r---\r# T\r"
  )
  assert.equal(
    withFrontMatterValue("---\ntitle: x\n---\n# T\n", "a.b", "1"),
    "---\ntitle: x\na.b: 1\n---\n# T\n"
  )
  assert.throws(() => withFrontMatterValue(null, "theme", "dark"), TypeError)
  assert.throws(() => withFrontMatterValue("# T\n", "", "dark"), TypeError)
})

test("appearance values still validate before delegating", () => {
  assert.equal(withAppearanceValue("# T\n", "theme", "dark"), "---\ntheme: dark\n---\n# T\n")
  assert.throws(() => withAppearanceValue("# T\n", "theme", "unknown"), TypeError)
  assert.throws(() => withAppearanceValue("# T\n", "title", "x"), TypeError)
})

test("heading replacement rewrites the first level-one heading", () => {
  assert.equal(replaceFirstHeading("# Old\n\nBody\n", "New"), "# New\n\nBody\n")
  assert.equal(replaceFirstHeading("  # Old\n", "New"), "  # New\n")
  assert.equal(replaceFirstHeading("# Old #\n", "New"), "# New\n")
  assert.equal(replaceFirstHeading("#\n\nBody\n", "New"), "# New\n\nBody\n")
  assert.equal(replaceFirstHeading("## Sub\n\n# Real\n", "New"), "## Sub\n\n# New\n")
  assert.equal(
    replaceFirstHeading("---\ntitle: x\n---\n# Old\n", "New"),
    "---\ntitle: x\n---\n# New\n"
  )
})

test("heading replacement skips fenced code and normalizes the title", () => {
  assert.equal(replaceFirstHeading("```md\n# Fake\n```\n\n# Real\n", "New"), "```md\n# Fake\n```\n\n# New\n")
  assert.equal(replaceFirstHeading("# Old\n", "a\r\nb  c"), "# a b c\n")
  assert.equal(replaceFirstHeading("# Old\r\n\r\nBody\r\n", "New"), "# New\r\n\r\nBody\r\n")
})

test("heading replacement inserts a heading when none exists", () => {
  assert.equal(replaceFirstHeading("Body text\n", "New"), "# New\n\nBody text\n")
  assert.equal(replaceFirstHeading("", "New"), "# New")
  assert.equal(replaceFirstHeading("---\ntitle: x\n---\nBody\n", "New"), "---\ntitle: x\n---\n# New\n\nBody\n")
  assert.equal(replaceFirstHeading("Body\r\n", "New"), "# New\r\n\r\nBody\r\n")
  assert.equal(replaceFirstHeading("Body\rmore\r", "New"), "# New\r\rBody\rmore\r")
  assert.throws(() => replaceFirstHeading(null, "New"), TypeError)
})

test("anchor lines number content lines after front matter", () => {
  assert.deepEqual(sourceAnchorLines("---\ntheme: dark\n---\n# Title\n\nParagraph.\n\n- Item"), [4, 6, 8])
  assert.deepEqual(sourceAnchorLines("# Title\n\nBody\n"), [1, 3])
  assert.deepEqual(sourceAnchorLines(":::section{A}\n\n# Title\n"), [3])
  assert.deepEqual(sourceAnchorLines(""), [1])
  assert.deepEqual(sourceAnchorLines("---\ntitle: x\n---\n"), [4])
  assert.deepEqual(sourceAnchorLines("---\r\ntitle: x\r\n---\r\n# T\r\n"), [4])
  assert.throws(() => sourceAnchorLines(null), TypeError)
})
