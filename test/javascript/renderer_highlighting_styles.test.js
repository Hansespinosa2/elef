import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const outputs = JSON.parse(await readFile(new URL("./fixtures/renderer-outputs.json", import.meta.url)))
const stylesheet = (await readFile(new URL("../../app/assets/stylesheets/application.css", import.meta.url), "utf8"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
const styleRules = [...stylesheet.matchAll(/([^{}]+)\{[^{}]*\}/g)]
const highlightedClasses = new Set(outputs.flatMap(({ blockHtml }) => {
  const classAttributes = [...blockHtml.matchAll(/\bclass="([^"]*)"/g)]
  return classAttributes.flatMap(([, classAttribute]) =>
    classAttribute.split(/\s+/).filter(className => className.startsWith("hljs-")))
}))

test("renderer fixture highlight.js tokens have styles on both surfaces", () => {
  assert.ok(highlightedClasses.size > 0, "Renderer fixtures should cover highlight.js tokens")

  for (const className of highlightedClasses) {
    for (const surface of ["presentation-surface", "document-surface"]) {
      const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const hasMatchingRule = styleRules.some(([rawSelectors]) => rawSelectors
        .split(",")
        .some(rawSelector => {
          const selector = rawSelector.trim()
          return selector.startsWith(`.${surface} .highlight`) &&
            new RegExp(`\\.${escapedClassName}(?![A-Za-z0-9_-])`).test(selector)
        }))

      assert.ok(hasMatchingRule, `.${className} needs a rule scoped to .${surface} .highlight`)
    }
  }
})
