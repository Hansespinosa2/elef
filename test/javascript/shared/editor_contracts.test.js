import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { bindEditorAction, editorActionControl } from "../../../app/javascript/lib/editor_actions.js"
import { clientMountController, startClientMounts, translateClientMounts, translateElementMounts } from "../../../app/javascript/lib/client_mounts.js"

function setup(html) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document
}

test("editor action controls resolve from descendants", () => {
  const document = setup(`<form><button data-editor-action="media-choose-slide" data-slide-index="2"><span>img</span></button></form>`)
  const form = document.querySelector("form")
  const span = document.querySelector("span")
  const control = editorActionControl({ target: span }, "media-choose-slide")
  assert.equal(control?.dataset.slideIndex, "2")
  assert.equal(editorActionControl({ target: span }, "overview-select"), null)
  assert.equal(editorActionControl({ target: form }, "media-choose-slide"), null)
})

test("bound editor actions dispatch only inside their root", () => {
  const document = setup(`<form><button data-editor-action="media-choose-slide" data-slide-index="2">img</button></form><button data-editor-action="media-choose-slide" data-slide-index="9">outside</button>`)
  const form = document.querySelector("form")
  const seen = []
  const unbind = bindEditorAction(form, "media-choose-slide", (event, control) => seen.push(control.dataset.slideIndex))
  const click = () => {
    const EventConstructor = document.defaultView?.Event ?? globalThis.Event
    return new EventConstructor("click", { bubbles: true })
  }
  document.querySelector("form button").dispatchEvent(click())
  document.querySelector("body > button").dispatchEvent(click())
  assert.deepEqual(seen, ["2"])
  unbind()
  document.querySelector("form button").dispatchEvent(click())
  assert.deepEqual(seen, ["2"])
})

test("client mount tokens translate to host controllers idempotently", () => {
  const document = setup(`<div data-client-mount="mermaid"></div><div data-client-mount="document-pages mermaid"></div><div data-controller="mermaid-diagrams" data-client-mount="mermaid"></div><div data-client-mount="file-library"></div>`)
  assert.equal(clientMountController("mermaid"), "mermaid-diagrams")
  assert.equal(clientMountController("document-pages"), "document-pages")
  assert.equal(clientMountController("file-library"), null)
  assert.equal(translateClientMounts(document), 3)
  const divs = [...document.querySelectorAll("div")]
  assert.equal(divs[0].getAttribute("data-controller"), "mermaid-diagrams")
  assert.equal(divs[1].getAttribute("data-controller"), "document-pages mermaid-diagrams")
  assert.equal(divs[2].getAttribute("data-controller"), "mermaid-diagrams")
  assert.equal(divs[3].hasAttribute("data-controller"), false)
  assert.equal(translateClientMounts(document), 3)
  assert.equal(divs[1].getAttribute("data-controller"), "document-pages mermaid-diagrams")
})

test("started mount observation translates late mounts", () => {
  let observed = null
  const previous = globalThis.MutationObserver
  globalThis.MutationObserver = class {
    constructor(callback) { observed = { callback, targets: [] } }
    observe(target, options) { observed.targets.push([target, options]) }
    disconnect() {}
  }
  try {
    const { document } = parseHTML("<html><body><main></main></body></html>")
    assert.equal(startClientMounts(document), true)
    assert.equal(startClientMounts(document), false)
    assert.equal(observed.targets.length, 1)
    const late = document.createElement("div")
    late.setAttribute("data-client-mount", "mermaid")
    observed.callback([{ type: "childList", addedNodes: [late] }])
    assert.equal(late.getAttribute("data-controller"), "mermaid-diagrams")
    const renamed = document.createElement("div")
    observed.callback([{ type: "attributes", attributeName: "data-client-mount", target: renamed }])
    assert.equal(renamed.hasAttribute("data-controller"), false)
    renamed.setAttribute("data-client-mount", "document-pages")
    observed.callback([{ type: "attributes", attributeName: "data-client-mount", target: renamed }])
    assert.equal(renamed.getAttribute("data-controller"), "document-pages")
  } finally {
    if (previous === undefined) delete globalThis.MutationObserver
    else globalThis.MutationObserver = previous
  }
})

test("translate element mounts merges with existing controllers", () => {
  const document = setup(`<div data-controller="preview" data-client-mount="mermaid unknown"></div>`)
  const div = document.querySelector("div")
  assert.equal(translateElementMounts(div), true)
  assert.equal(div.getAttribute("data-controller"), "preview mermaid-diagrams")
})
