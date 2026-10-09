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

function revealFrame(document, count, blocks) {
  const frame = slide(document, "")
  const canvas = document.createElement("section")
  canvas.className = "slide"
  if (count > 0) canvas.setAttribute("data-elef-reveal-event-count", String(count))
  for (const { event, text, link = false, video = false, controls = false } of blocks) {
    const block = document.createElement("div")
    block.className = "slide-block"
    if (event !== null) block.setAttribute("data-elef-reveal-event", String(event))
    block.textContent = text
    if (link) {
      const anchor = document.createElement("a")
      anchor.href = "https://example.test"
      anchor.textContent = "Focusable link"
      block.append(anchor)
    }
    if (video) {
      const media = document.createElement("video")
      media.playCount = 0
      media.pauseCount = 0
      media.play = () => { media.playCount += 1; return Promise.resolve() }
      media.pause = () => { media.pauseCount += 1 }
      block.append(media)
    }
    canvas.append(block)
    if (controls) {
      const editorControls = document.createElement("div")
      editorControls.className = "presentation-editor-block-controls"
      canvas.append(editorControls)
    }
  }
  frame.append(canvas)
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

test("reveals preserve geometry membership, accessibility, editor controls, and media timing", () => {
  const previousDocument = globalThis.document
  const { document, stage, controller } = mount()
  const mediaFrame = revealFrame(document, 2, [
    { event: 0, text: "First event", video: true },
    { event: 1, text: "Second event", link: true, controls: true },
    { event: null, text: "Unmarked content", video: true }
  ])
  const emptyFrame = revealFrame(document, 0, [{ event: null, text: "Empty slide" }])
  stage.replaceChildren(mediaFrame, emptyFrame)
  globalThis.document = document

  try {
    controller.connect()
    const [firstBlock, secondBlock, unmarkedBlock] = mediaFrame.querySelectorAll(".slide-block")
    const controls = secondBlock.nextElementSibling
    const [steppedVideo, unmarkedVideo] = mediaFrame.querySelectorAll("video")

    assert.equal(firstBlock.classList.contains("is-presentation-reveal-hidden"), true)
    assert.equal(firstBlock.getAttribute("aria-hidden"), "true")
    assert.equal(firstBlock.hasAttribute("inert"), true)
    assert.equal(secondBlock.hasAttribute("inert"), true)
    assert.equal(controls.hidden, true)
    assert.equal(unmarkedBlock.hasAttribute("inert"), false)
    assert.equal(steppedVideo.playCount, 0, "a video in a hidden event does not start early")
    assert.equal(unmarkedVideo.playCount, 1, "unmarked video keeps slide-entry playback")

    controller.next()
    assert.equal(firstBlock.classList.contains("is-presentation-reveal-hidden"), false)
    assert.equal(firstBlock.hasAttribute("inert"), false)
    assert.equal(steppedVideo.playCount, 1)
    assert.equal(secondBlock.hasAttribute("inert"), true)

    controller.next()
    assert.equal(secondBlock.hasAttribute("aria-hidden"), false)
    assert.equal(secondBlock.hasAttribute("inert"), false)
    assert.equal(controls.hidden, false)
    assert.equal(secondBlock.querySelector("a").getAttribute("href"), "https://example.test")

    controller.next()
    assert.equal(controller.indexValue, 1)
    assert.ok(steppedVideo.pauseCount > 0, "leaving the slide pauses its video")
    assert.ok(unmarkedVideo.pauseCount > 0, "leaving the slide pauses unmarked video")
  } finally {
    controller.disconnect()
    globalThis.document = previousDocument
  }
})

test("reversing, preview refresh, stop, and re-entry restore the current event state", () => {
  const previousDocument = globalThis.document
  const { document, CustomEvent, form, stage, controller } = mount()
  stage.replaceChildren(revealFrame(document, 2, [
    { event: 0, text: "One", link: true },
    { event: 1, text: "Two", controls: true }
  ]))
  globalThis.document = document

  try {
    controller.connect()
    controller.next()
    controller.next()
    let [first, second] = stage.querySelectorAll(".slide-block")
    assert.equal(second.hasAttribute("inert"), false)

    controller.previous()
    assert.equal(second.hasAttribute("inert"), true)
    assert.equal(second.nextElementSibling.hidden, true)
    controller.previous()
    assert.equal(first.hasAttribute("inert"), true)

    stage.replaceChildren(revealFrame(document, 1, [{ event: 0, text: "Updated one", controls: true }]))
    form.dispatchEvent(new CustomEvent("elef:preview-updated", { bubbles: true }))
    const [updated] = stage.querySelectorAll(".slide-block")
    assert.equal(controller.indexValue, 0)
    assert.equal(controller.navigation.revealedEventCount, 0, "saved progress clamps to the refreshed count")
    assert.equal(updated.hasAttribute("inert"), true)

    controller.next()
    assert.equal(updated.hasAttribute("inert"), false)
    controller.stop()
    assert.equal(updated.hasAttribute("inert"), false)
    assert.equal(updated.hasAttribute("aria-hidden"), false)
    assert.equal(updated.classList.contains("is-presentation-reveal-hidden"), false)
    assert.equal(updated.nextElementSibling.hidden, false)

    controller.start()
    assert.equal(controller.indexValue, 0)
    assert.equal(controller.navigation.revealedEventCount, 0, "re-entering starts at the first event")
    assert.equal(updated.hasAttribute("inert"), true)
  } finally {
    controller.disconnect()
    globalThis.document = previousDocument
  }
})
