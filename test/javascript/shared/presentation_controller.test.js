import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseHTML } from "linkedom"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const sourcePath = path.join(root, "app/javascript/controllers/presentation_controller.js")
const navigationPath = pathToFileURL(path.join(root, "app/javascript/lib/presentation_navigation.js")).href
const source = (await readFile(sourcePath, "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace(
    'import { createPresentationNavigation, presentationActionForKey } from "lib/presentation_navigation"',
    `import { createPresentationNavigation, presentationActionForKey } from "${navigationPath}"`
  )
const presentation = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

function slide(document, text) {
  const frame = document.createElement("div")
  frame.className = "slide-frame"
  frame.textContent = text
  return frame
}

function mount() {
  const { document, CustomEvent } = parseHTML("<html><body><form><div id='stage'></div><output id='counter'></output></form></body></html>")
  const form = document.querySelector("form")
  const stage = document.querySelector("#stage")
  const counter = document.querySelector("#counter")
  stage.focus = () => {}
  stage.append(slide(document, "First"), slide(document, "Second"))

  const controller = new presentation.default()
  Object.assign(controller, {
    element: form,
    stageTarget: stage,
    hasStageTarget: true,
    hasCounterTarget: true,
    counterTarget: counter,
    activeValue: true,
    indexValue: 0
  })
  return { document, CustomEvent, form, stage, counter, controller }
}

test("presentation follows new slide elements after the shared preview replaces its DOM", () => {
  const previousDocument = globalThis.document
  const { document, CustomEvent, form, stage, counter, controller } = mount()
  globalThis.document = document

  try {
    controller.connect()
    controller.next()
    assert.equal(controller.indexValue, 1)

    stage.replaceChildren(slide(document, "Updated first"), slide(document, "Updated second"), slide(document, "Updated third"))
    form.dispatchEvent(new CustomEvent("elef:preview-updated", { bubbles: true }))

    const slides = [...stage.querySelectorAll(".slide-frame")]
    assert.equal(slides[0].hidden, true)
    assert.equal(slides[1].hidden, false)
    assert.equal(slides[1].classList.contains("is-active-presentation-slide"), true)
    assert.equal(slides[2].hidden, true)
    assert.equal(counter.textContent, "2 / 3")
  } finally {
    controller.disconnect()
    globalThis.document = previousDocument
  }
})

test("presentation clamps its index when a refreshed preview has fewer slides", () => {
  const previousDocument = globalThis.document
  const { document, CustomEvent, form, stage, counter, controller } = mount()
  globalThis.document = document

  try {
    controller.connect()
    controller.next()
    stage.replaceChildren(slide(document, "Only slide"))
    form.dispatchEvent(new CustomEvent("elef:preview-updated", { bubbles: true }))

    const [onlySlide] = stage.querySelectorAll(".slide-frame")
    assert.equal(controller.indexValue, 0)
    assert.equal(onlySlide.hidden, false)
    assert.equal(counter.textContent, "1 / 1")
  } finally {
    controller.disconnect()
    globalThis.document = previousDocument
  }
})
