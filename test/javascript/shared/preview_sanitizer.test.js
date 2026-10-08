import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { renderPreviewCore } from "@elef/renderer"
import { editorChrome } from "../../../app/javascript/lib/preview_chrome.js"
import { installSanitizedPreview } from "../../../app/javascript/lib/preview_sanitizer.js"
import { CASES, runChecks } from "./preview_sanitizer_cases.js"

const renderPreview = input => renderPreviewCore(input, { chrome: editorChrome })

function freshContainer() {
  const { document } = parseHTML("<main id='preview'></main>")
  return document.querySelector("#preview")
}

for (const kase of CASES) {
  test(kase.name, () => {
    const container = freshContainer()
    for (const install of kase.installs) {
      const html = install.render ? renderPreview(install.render).html : install.html
      installSanitizedPreview(container, html, install.options)
    }
    runChecks(container, kase.checks, assert)
  })
}
