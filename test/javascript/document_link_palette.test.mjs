import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const source = (await readFile(new URL("../../app/javascript/controllers/document_link_palette_controller.js", import.meta.url), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { editorFor } from "lib/editor_controller_lookup"', "const editorFor = () => null")
const palette = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

const { insideCode, insideInlineCode, rankLinkTitles, scoreLinkTitle } = palette

function matchesSelector(element, selector) {
  const attribute = selector.match(/^\[([^=]+)="([^"]*)"\]$/)
  if (attribute) return element.getAttribute(attribute[1]) === attribute[2]
  return element.tagName === selector.toUpperCase()
}

function node(tagName, { attributes = {}, rect = null, text = "" } = {}) {
  return {
    tagName: tagName.toUpperCase(),
    attributes: { ...attributes },
    children: [],
    parentElement: null,
    className: "",
    textContent: text,
    hidden: false,
    id: "",
    style: {},
    rect,
    listeners: new Map(),
    added: [],
    events: [],
    focused: false,
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null },
    setAttribute(name, value) { this.attributes[name] = String(value) },
    removeAttribute(name) { delete this.attributes[name] },
    addEventListener(name, listener) {
      this.added.push(name)
      this.listeners.set(name, listener)
    },
    removeEventListener(name) { this.listeners.delete(name) },
    dispatchEvent(event) { this.events.push(event.type) },
    append(...nodes) {
      for (const child of nodes) {
        child.parentElement = this
        this.children.push(child)
      }
    },
    replaceChildren(...nodes) {
      this.children = []
      this.append(...nodes)
    },
    remove() {
      const index = this.parentElement?.children.indexOf(this) ?? -1
      if (index >= 0) this.parentElement.children.splice(index, 1)
      this.parentElement = null
    },
    descendants() {
      return this.children.flatMap((child) => [child, ...child.descendants()])
    },
    matches(selector) { return matchesSelector(this, selector) },
    querySelectorAll(selector) { return this.descendants().filter((child) => child.matches(selector)) },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null },
    focus() { this.focused = true },
    setSelectionRange(from, to = from) {
      this.selectionStart = from
      this.selectionEnd = to
    },
    getBoundingClientRect() {
      return this.rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    }
  }
}

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  listeners: new Map(),
  added: [],
  addEventListener(name, listener) {
    this.added.push(name)
    this.listeners.set(name, listener)
  },
  removeEventListener(name) { this.listeners.delete(name) }
}
globalThis.document = {
  body: node("body"),
  createElement(tagName) { return node(tagName) },
  createTextNode(text) { return node("#text", { text }) }
}
globalThis.getComputedStyle = () => ({
  font: "16px serif",
  lineHeight: "24px",
  letterSpacing: "0px",
  padding: "8px",
  border: "1px solid #ddd"
})

const EDITOR_RECT = { left: 40, top: 60, right: 640, bottom: 260, width: 600, height: 200 }
const PALETTE_RECT = { left: 0, top: 0, right: 160, bottom: 120, width: 160, height: 120 }

function build({ titles = [], value = "", caret = value.length, editorController: withEditorController = false } = {}) {
  const editorTarget = node("textarea", { rect: EDITOR_RECT })
  editorTarget.value = value
  editorTarget.selectionStart = caret
  editorTarget.selectionEnd = caret
  editorTarget.clientWidth = 600
  editorTarget.scrollTop = 0
  editorTarget.scrollLeft = 0

  const paletteTarget = node("div", { attributes: { role: "listbox" }, rect: PALETTE_RECT })
  paletteTarget.id = "document-link-palette"
  paletteTarget.hidden = true

  const element = node("div")
  element.append(editorTarget, paletteTarget)

  let editor = null
  if (withEditorController) {
    const dom = node("div", { attributes: { role: "textbox", "aria-controls": "existing-list" }, rect: EDITOR_RECT })
    element.append(dom)
    editor = {
      dom,
      scrollElement: node("div"),
      value,
      selectionStart: caret,
      view: { coordsAtPos: () => ({ left: 120, top: 180, bottom: 200 }) },
      calls: [],
      replaceRange(insert, from, to = from) { this.calls.push(["replaceRange", insert, from, to]) },
      focus() { this.calls.push(["focus"]) },
      setSelectionRange(from, to = from) { this.calls.push(["setSelectionRange", from, to]) }
    }
  }

  const controller = new palette.default()
  Object.assign(controller, {
    element,
    editorTarget,
    paletteTarget,
    titlesValue: titles,
    editorController: editor,
    matches: [],
    selectedIndex: 0,
    editorReady: null,
    scrollBound: false,
    keydownBound: false,
    nativeScrollBound: false
  })
  return { controller, editorTarget, paletteTarget, element, editor, editorDom: editor?.dom }
}

function keyEvent(key, extra = {}) {
  return { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...extra }
}

test("insideCode keeps autocomplete closed for indented and fenced source", () => {
  assert.equal(insideCode("Prose [[Re"), false)
  assert.equal(insideCode("Prose\n[[Re"), false)
  assert.equal(insideCode("Prose\n\n    [[Re"), true)
  assert.equal(insideCode("Prose\n\t[[Re"), true)
  assert.equal(insideCode("```\ncode [[Re"), true)
  assert.equal(insideCode("~~~sql\ncode [[Re"), true)
  assert.equal(insideCode("```js\ncode\n```\n[[Re"), false)
  assert.equal(insideCode("~~~sql\ncode\n~~~\n[[Re"), false)
  assert.equal(insideCode("```js\ncode\n"), true)
})

test("insideCode only lets a same-character fence of equal or greater length close the block", () => {
  assert.equal(insideCode("```js\ncode\n~~~~\n[[Re"), true)
  assert.equal(insideCode("```js\ncode\n``~~~\n[[Re"), true)
  assert.equal(insideCode("```js\ncode\n````\n[[Re"), false)
  assert.equal(insideCode("````js\ncode\n```\n[[Re"), true)
  assert.equal(insideCode("```js\ncode ```\n[[Re"), true)
  assert.equal(insideCode("```js\ncode ``` trailing\n[[Re"), true)
})

test("insideInlineCode detects only unbalanced backtick spans", () => {
  assert.equal(insideInlineCode("plain text"), false)
  assert.equal(insideInlineCode("`closed`"), false)
  assert.equal(insideInlineCode("`opened"), true)
  assert.equal(insideInlineCode("``opened"), true)
  assert.equal(insideInlineCode("``closed``"), false)
  assert.equal(insideInlineCode("`one` and ``two``"), false)
  assert.equal(insideInlineCode("a `b` c [[Re"), false)
  assert.equal(insideCode("`code [[Re"), true)
})

test("scoreLinkTitle ranks prefixes ahead of later substrings and rejects misses", () => {
  assert.equal(scoreLinkTitle("Research target", "res"), 0)
  assert.equal(scoreLinkTitle("research target", "res"), 0)
  assert.equal(scoreLinkTitle("A research target", "res"), 3)
  assert.equal(scoreLinkTitle("Unrelated", "res"), null)
  assert.equal(scoreLinkTitle("Anything", ""), 0)
})

test("rankLinkTitles orders by score then alphabetically and drops misses", () => {
  const titles = ["Zebra research", "Research alpha", "alpha research beta", "Unrelated note", "Research zebra"]

  assert.deepEqual(rankLinkTitles(titles, "re"), ["Research alpha", "Research zebra", "Unrelated note", "alpha research beta", "Zebra research"])
  assert.deepEqual(rankLinkTitles(["b", "a", "c"], ""), ["a", "b", "c"])
  assert.deepEqual(rankLinkTitles(titles, "zzz"), [])
})

test("refresh opens the palette with the ranked matches for an open link token", () => {
  const { controller, paletteTarget, editorTarget } = build({
    titles: ["Research target", "Research zebra", "Unrelated note"],
    value: "# Source\n\n[[Research"
  })

  controller.refresh()

  assert.equal(controller.query, "research")
  assert.equal(controller.queryStart, editorTarget.value.length - "Research".length - 2)
  assert.deepEqual(controller.matches, ["Research target", "Research zebra"])
  assert.equal(controller.selectedIndex, 0)
  assert.equal(paletteTarget.hidden, false)
  assert.deepEqual(paletteTarget.children.map((option) => option.textContent), ["Research target", "Research zebra"])
})

test("refresh hides the palette when the caret leaves the link token", () => {
  const { controller, paletteTarget } = build({ titles: ["Research target"], value: "See [[Research target]] tail", caret: 4 })

  controller.refresh()

  assert.equal(paletteTarget.hidden, true)
  assert.deepEqual(controller.matches, [])
  assert.equal(paletteTarget.children.length, 0)
})

test("refresh stays closed inside fenced, indented, and inline code", () => {
  for (const value of ["```\n[[Research ta", "Prose\n\n    [[Research ta", "`[[Research ta"]) {
    const { controller, paletteTarget } = build({ titles: ["Research target"], value })
    controller.refresh()
    assert.equal(paletteTarget.hidden, true, value)
    assert.deepEqual(controller.matches, [], value)
  }
})

test("renderPalette marks the five visible options, selects the first, and positions under the caret", () => {
  const { controller, paletteTarget, editor, editorDom } = build({
    titles: ["A one", "B two", "C three", "D four", "E five", "F six"],
    value: "[[",
    editorController: true
  })

  controller.refresh()

  assert.deepEqual(paletteTarget.children.map((option) => option.textContent), ["A one", "B two", "C three", "D four", "E five"])
  assert.deepEqual(paletteTarget.children.map((option) => option.id), [
    "document-link-palette-option-0",
    "document-link-palette-option-1",
    "document-link-palette-option-2",
    "document-link-palette-option-3",
    "document-link-palette-option-4"
  ])
  assert.deepEqual(paletteTarget.children.map((option) => option.getAttribute("aria-selected")), ["true", "false", "false", "false", "false"])
  assert.deepEqual(paletteTarget.children.map((option) => option.className), [
    "document-link-option is-selected",
    "document-link-option",
    "document-link-option",
    "document-link-option",
    "document-link-option"
  ])
  assert.equal(editorDom.getAttribute("aria-expanded"), "true")
  assert.equal(editorDom.getAttribute("aria-activedescendant"), "document-link-palette-option-0")
  assert.equal(paletteTarget.style.left, "120px")
  assert.equal(paletteTarget.style.top, "136px")
  assert.equal(editor.selectionStart, 2)
})

test("close clears aria-expanded and aria-activedescendant on the CodeMirror editor", () => {
  const { controller, paletteTarget, editorDom } = build({ titles: ["A one"], value: "[[one", editorController: true })

  controller.refresh()
  assert.equal(paletteTarget.hidden, false)
  assert.equal(editorDom.getAttribute("aria-activedescendant"), "document-link-palette-option-0")

  controller.close()

  assert.equal(paletteTarget.hidden, true)
  assert.deepEqual(controller.matches, [])
  assert.equal(editorDom.getAttribute("aria-expanded"), "false")
  assert.equal(editorDom.getAttribute("aria-activedescendant"), null)
})

test("setupAccessibility keeps existing aria-controls and links the palette to the editor", () => {
  const { controller, paletteTarget, editorDom } = build({ value: "[[", editorController: true })

  controller.setupAccessibility()

  assert.equal(editorDom.getAttribute("aria-controls"), "existing-list document-link-palette")
  assert.equal(editorDom.getAttribute("aria-autocomplete"), "list")
  assert.equal(paletteTarget.id, "document-link-palette")
})

test("connect announces the palette and binds resize plus the textarea scroll listener", () => {
  const { controller, paletteTarget, editorTarget } = build({ titles: ["A one"], value: "[[" })

  controller.connect()

  assert.equal(paletteTarget.getAttribute("aria-live"), "polite")
  assert.deepEqual(globalThis.window.added, ["resize"])
  assert.deepEqual(editorTarget.added, ["scroll"])
  assert.equal(controller.nativeScrollBound, true)

  controller.disconnect()

  assert.equal(globalThis.window.listeners.has("resize"), false)
  assert.equal(editorTarget.listeners.size, 0)
})

test("setupEditor binds the CodeMirror scroll and capture-phase keydown once and unbinds on disconnect", () => {
  const { controller, editorTarget, editor } = build({ titles: ["A one"], value: "[[", editorController: true })

  controller.setupEditor()
  controller.setupEditor()

  assert.deepEqual(editor.scrollElement.added, ["scroll"])
  assert.deepEqual(editor.dom.added, ["keydown"])
  assert.equal(controller.scrollBound, true)
  assert.equal(controller.keydownBound, true)
  assert.equal(controller.nativeScrollBound, false)
  assert.equal(editorTarget.added.length, 0)

  controller.disconnect()

  assert.equal(editor.scrollElement.listeners.size, 0)
  assert.equal(editor.dom.listeners.size, 0)
})

test("setupEditor falls back to the textarea once the CodeMirror editor is gone", () => {
  const { controller, editorTarget, editor } = build({ titles: ["A one"], value: "[[", editorController: true })

  controller.setupEditor()
  controller.editorController = null
  controller.setupEditor()

  assert.equal(controller.nativeScrollBound, true)
  assert.deepEqual(editorTarget.added, ["scroll"])
  assert.equal(editor.scrollElement.listeners.size, 1)
})

test("keydown moves the selection within the five visible options and closes on Escape", () => {
  const { controller, paletteTarget } = build({ titles: ["A one", "B two", "C three", "D four", "E five", "F six"], value: "[[" })

  controller.refresh()

  for (const expected of [1, 2, 3, 4, 4, 4]) {
    const down = keyEvent("ArrowDown")
    controller.keydown(down)
    assert.equal(down.defaultPrevented, true)
    assert.equal(controller.selectedIndex, expected)
  }
  assert.deepEqual(paletteTarget.children.map((option) => option.getAttribute("aria-selected")), ["false", "false", "false", "false", "true"])

  for (const expected of [3, 2, 1, 0, 0]) {
    const up = keyEvent("ArrowUp")
    controller.keydown(up)
    assert.equal(up.defaultPrevented, true)
    assert.equal(controller.selectedIndex, expected)
  }

  const escape = keyEvent("Escape")
  controller.keydown(escape)
  assert.equal(escape.defaultPrevented, true)
  assert.equal(paletteTarget.hidden, true)

  const ignored = keyEvent("ArrowDown")
  controller.keydown(ignored)
  assert.equal(ignored.defaultPrevented, false)
})

test("keydown ignores editor events that do not come from the palette editor controller", () => {
  const { controller } = build({ titles: ["A one"], value: "[[", editorController: true })

  controller.refresh()
  const event = keyEvent("ArrowDown", { currentTarget: controller.editorTarget })
  controller.keydown(event)

  assert.equal(event.defaultPrevented, false)
  assert.equal(controller.selectedIndex, 0)
})

test("Enter and Tab insert the selected title and close the palette", () => {
  for (const key of ["Enter", "Tab"]) {
    const { controller, paletteTarget, editorTarget } = build({ titles: ["Alpha", "Beta"], value: "[[Al" })

    controller.refresh()
    const event = keyEvent(key)
    controller.keydown(event)

    assert.equal(event.defaultPrevented, true, key)
    assert.equal(editorTarget.value, "[[Alpha]]", key)
    assert.equal(paletteTarget.hidden, true, key)
  }
})

test("insertSelected rewrites the token in a plain textarea and restores the caret", () => {
  const { controller, editorTarget } = build({ titles: ["Research target", "Research zebra"], value: "See [[Research ta" })

  controller.refresh()
  controller.insertSelected()

  assert.equal(editorTarget.value, "See [[Research target]]")
  assert.equal(editorTarget.selectionStart, "See ".length + "[[Research target]]".length)
  assert.equal(editorTarget.selectionEnd, editorTarget.selectionStart)
  assert.deepEqual(editorTarget.events, ["input"])
  assert.deepEqual(controller.matches, [])
})

test("insertSelected commits through the editor controller and leaves the textarea alone", () => {
  const { controller, editorTarget, editor } = build({ titles: ["Research target"], value: "[[Research ta", editorController: true })

  controller.refresh()
  controller.insertSelected()

  assert.deepEqual(editor.calls, [
    ["replaceRange", "[[Research target]]", 0, "[[Research ta".length],
    ["focus"],
    ["setSelectionRange", "[[Research target]]".length, "[[Research target]]".length]
  ])
  assert.equal(editorTarget.value, "[[Research ta")
})

test("mousedown on a visible option selects it before inserting", () => {
  const { controller, editorTarget } = build({ titles: ["A one", "B two"], value: "[[" })

  controller.refresh()
  const event = keyEvent("MouseEvent")
  controller.paletteTarget.children[1].listeners.get("mousedown")(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(editorTarget.value, "[[B two]]")
  assert.equal(editorTarget.selectionStart, "[[B two]]".length)
})

test("insertSelected without a match only closes the palette", () => {
  const { controller, paletteTarget, editorTarget } = build({ titles: ["A one"], value: "[[zzz" })

  controller.refresh()
  controller.insertSelected()

  assert.equal(paletteTarget.hidden, true)
  assert.equal(editorTarget.value, "[[zzz")
  assert.deepEqual(editorTarget.events, [])
})

test("focusResult only takes focus on ArrowDown", () => {
  const { controller, paletteTarget } = build({ titles: ["A one", "B two"], value: "[[" })

  controller.refresh()
  const first = paletteTarget.children[0]

  controller.focusResult(keyEvent("Enter"))
  assert.equal(first.focused, false)

  controller.focusResult(keyEvent("ArrowDown"))
  assert.equal(first.focused, true)
})
