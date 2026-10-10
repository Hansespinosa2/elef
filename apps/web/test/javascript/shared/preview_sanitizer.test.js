import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { renderPreviewCore } from "@elef/renderer"
import { editorChrome } from "@elef/editor-runtime/editor-chrome"
import { sanitizePreview as installSanitizedPreview } from "@elef/client/sanitize"
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

test("interactive preview keeps only enumerated Art state and its trusted layout controller", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  installSanitizedPreview(container, `
    <div data-controller="mermaid-diagrams art-layout" data-art-host="fixed" data-art-overfull="false">
      <section data-elef-art-root data-art-mode="sequence" data-art-density="compact" data-art-status="pending" data-art-layout="sequence-vertical" data-art-settled="false">
        <ol class="elef-art-list" start="0"><li>Keep all source</li></ol>
      </section>
      <section data-elef-art-root data-art-mode="evil" data-art-status="ready" data-art-layout="injected" data-art-diagnostic=".evil { display:none }">Rejected metadata</section>
    </div>`)

  const host = container.querySelector("[data-art-host]")
  const art = container.querySelector("[data-elef-art-root]")
  const hostile = container.querySelectorAll("[data-elef-art-root]")[1]
  assert.equal(host.getAttribute("data-controller"), "mermaid-diagrams art-layout")
  assert.equal(host.getAttribute("data-art-overfull"), "false")
  assert.equal(art.getAttribute("data-art-mode"), "sequence")
  assert.equal(art.getAttribute("data-art-status"), "pending")
  assert.equal(art.getAttribute("data-art-layout"), "sequence-vertical")
  assert.equal(art.getAttribute("data-elef-art-root"), "")
  assert.equal(art.querySelector("ol").getAttribute("start"), "0")
  assert.equal(hostile.hasAttribute("data-art-mode"), false)
  assert.equal(hostile.hasAttribute("data-art-layout"), false)
  assert.equal(hostile.hasAttribute("data-art-diagnostic"), false)
  assert.equal(hostile.textContent, "Rejected metadata")
})

test("preview rejects non-numeric or unordered-list start attributes", () => {
  const { document } = parseHTML("<main id='preview'></main>")
  const container = document.querySelector("#preview")
  installSanitizedPreview(container, '<ol start="-1"><li>negative</li></ol><ul start="3"><li>unordered</li></ul><ol start="3"><li>valid</li></ol>')
  const lists = container.querySelectorAll("ol, ul")
  assert.equal(lists[0].hasAttribute("start"), false)
  assert.equal(lists[1].hasAttribute("start"), false)
  assert.equal(lists[2].getAttribute("start"), "3")
})
