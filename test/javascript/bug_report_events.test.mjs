import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
const eventSource = await readFile(new URL("../../app/javascript/bug_report_events.js", import.meta.url), "utf8")
const eventModule = await import(`data:text/javascript;base64,${Buffer.from(eventSource).toString("base64")}`)
const {
  BugReportEventRecorder,
  describeTarget,
  formatReproductionSteps,
  isSensitiveField
} = eventModule

class FakeElement {
  constructor(tagName, { attributes = {}, text = "", labels = [], parent = null, contentEditable = false } = {}) {
    this.nodeType = 1
    this.tagName = tagName.toUpperCase()
    this.attributes = attributes
    this.textContent = text
    this.innerText = text
    this.labels = labels
    this.parentElement = parent
    this.ownerDocument = null
    this.isContentEditable = contentEditable
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name)
  }

  matches(selector) {
    return selector.split(",").some((part) => this.matchesPart(part.trim()))
  }

  matchesPart(selector) {
    if (selector === "[data-bug-report-ignore]" || selector === "[data-bug-reporting-ui]") return this.hasAttribute(selector.slice(1, -1))
    if (selector === "button") return this.tagName === "BUTTON"
    if (selector === "a[href]") return this.tagName === "A" && this.hasAttribute("href")
    if (selector === "input") return this.tagName === "INPUT"
    if (selector === "textarea") return this.tagName === "TEXTAREA"
    if (selector === "select") return this.tagName === "SELECT"
    if (selector === "summary") return this.tagName === "SUMMARY"
    if (selector === "[role='button']") return this.getAttribute("role") === "button"
    if (selector === "[role='link']") return this.getAttribute("role") === "link"
    if (selector === "[contenteditable='true']") return this.getAttribute("contenteditable") === "true"
    if (selector === "[data-action]") return this.hasAttribute("data-action")
    if (selector.startsWith("[tabindex]")) return this.hasAttribute("tabindex") && this.getAttribute("tabindex") !== "-1"
    if (selector === "[role='toolbar']") return this.getAttribute("role") === "toolbar"
    if ([".editor-toolbar", ".presentation-toolbar", ".document-toolbar"].includes(selector)) return this.getAttribute("class")?.split(/\s+/).includes(selector.slice(1))
    return false
  }

  closest(selector) {
    let element = this
    while (element) {
      if (element.matches(selector)) return element
      element = element.parentElement
    }
    return null
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(name, callback) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), callback])
  }

  removeEventListener(name, callback) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((listener) => listener !== callback))
  }

  dispatch(name, event = {}) {
    for (const callback of this.listeners.get(name) || []) callback(event)
  }
}

function recorder(options = {}) {
  let time = options.time || 0
  const documentRef = new FakeEventTarget()
  const windowRef = new FakeEventTarget()
  const locationRef = { pathname: options.pathname || "/documents/42" }
  const instance = new BugReportEventRecorder({
    documentRef,
    windowRef,
    locationRef,
    now: () => time,
    maxAgeMs: options.maxAgeMs,
    maxCount: options.maxCount
  }).start()
  return {
    instance,
    documentRef,
    windowRef,
    locationRef,
    setTime(value) { time = value },
    getTime() { return time }
  }
}

test("evicts the oldest event when the count limit is exceeded", () => {
  const { instance, setTime } = recorder({ maxCount: 2 })
  instance.record({ type: "key", key: "Enter" }, 1)
  instance.record({ type: "key", key: "Tab" }, 2)
  instance.record({ type: "key", key: "Escape" }, 3)

  assert.deepEqual(instance.snapshot().map((event) => event.key), ["Tab", "Escape"])
  setTime(3)
})

test("evicts events older than the rolling age limit", () => {
  const { instance } = recorder({ maxAgeMs: 10, maxCount: 10 })
  instance.record({ type: "key", key: "Enter" }, 0)
  instance.record({ type: "key", key: "Tab" }, 8)
  instance.record({ type: "key", key: "Escape" }, 11)

  assert.deepEqual(instance.snapshot().map((event) => event.key), ["Tab", "Escape"])
})

test("applies age and count limits together", () => {
  const { instance, setTime } = recorder({ maxAgeMs: 10, maxCount: 2 })
  instance.record({ type: "key", key: "A" }, 0)
  instance.record({ type: "key", key: "B" }, 1)
  instance.record({ type: "key", key: "C" }, 2)
  setTime(11)
  instance.record({ type: "key", key: "D" })

  assert.deepEqual(instance.snapshot().map((event) => event.key), ["C", "D"])
})

test("preserves event order and gives snapshots independent event objects", () => {
  const { instance } = recorder()
  instance.record({ type: "click", target: '"New Document"' }, 2)
  instance.record({ type: "key", key: "Enter" }, 3)
  const snapshot = instance.snapshot()
  instance.record({ type: "click", target: '"Present"' }, 4)
  snapshot[0].target = "changed by caller"

  assert.deepEqual(instance.snapshot().map((event) => event.type), ["navigate", "click", "key", "click"])
  assert.equal(instance.snapshot()[1].target, '"New Document"')
  assert.equal(snapshot.length, 3)
})

test("describes clicks with accessible labels and toolbar context", () => {
  const labeledButton = new FakeElement("button", { attributes: { "aria-label": "Open command palette" } })
  const toolbar = new FakeElement("div", { attributes: { role: "toolbar" } })
  const exportButton = new FakeElement("button", { text: "Export", parent: toolbar })
  const documentTitle = new FakeElement("input", { attributes: { type: "text" }, labels: [{ textContent: "Document title" }] })
  const slideButton = new FakeElement("button", { attributes: { "data-editor-slide-id": "slide-42" } })
  const identifiedButton = new FakeElement("button", { attributes: { "data-testid": "export-menu" } })

  assert.equal(describeTarget(labeledButton), '"Open command palette"')
  assert.equal(describeTarget(exportButton), 'toolbar button "Export"')
  assert.equal(describeTarget(documentTitle), "document title field")
  assert.equal(describeTarget(slideButton), 'button data-editor-slide-id "slide-42"')
  assert.equal(describeTarget(identifiedButton), 'button data-testid "export-menu"')
})

test("redacts password, secret, email, and sensitive autocomplete values before buffering", () => {
  const { instance } = recorder()
  const password = new FakeElement("input", { attributes: { type: "password", name: "account[password]" } })
  const apiToken = new FakeElement("input", { attributes: { type: "text", name: "api_token" } })
  const email = new FakeElement("input", { attributes: { type: "email", name: "account[email]" } })
  const cardNumber = new FakeElement("input", { attributes: { type: "text", autocomplete: "cc-number" } })

  for (const field of [password, apiToken, email, cardNumber]) {
    assert.equal(isSensitiveField(field), true)
    instance.recordTyping(field, "never-store-this")
  }

  assert.equal(instance.events.filter((event) => event.type === "typing").every((event) => event.text === "[REDACTED]"), true)
  assert.equal(JSON.stringify(instance.events).includes("never-store-this"), false)
  assert.equal(formatReproductionSteps(instance.snapshot()).includes("never-store-this"), false)
  assert.match(formatReproductionSteps(instance.snapshot()), /\[REDACTED\]/)
})

test("keeps normal text and compacts contiguous typing into one readable action", () => {
  const { instance, setTime } = recorder()
  const field = new FakeElement("input", { attributes: { type: "text" }, labels: [{ textContent: "Document title" }] })
  for (const [index, character] of [..."Quarterly Review"].entries()) {
    setTime(index * 50)
    instance.recordTyping(field, character)
  }

  const snapshot = instance.snapshot()
  assert.equal(snapshot.at(-1).text, "Quarterly Review")
  assert.match(formatReproductionSteps(snapshot), /Typed "Quarterly Review" into document title field/)
})

test("caps a single stored typing action so large text cannot bypass the bounded buffer", () => {
  const { instance } = recorder()
  const field = new FakeElement("textarea", { labels: [{ textContent: "Notes" }] })
  instance.recordTyping(field, "x".repeat(100_000))

  assert.equal(instance.snapshot().at(-1).text.length, 500)
})

test("captures logical special keys and shortcuts while ignoring repeats and modifier noise", () => {
  const { instance, documentRef } = recorder()
  const field = new FakeElement("input", { attributes: { type: "text" } })
  for (const key of ["Enter", "Escape", "Tab", "Backspace", "Delete"]) {
    documentRef.dispatch("keydown", { target: field, key })
  }
  documentRef.dispatch("keydown", { target: field, key: "s", ctrlKey: true })
  documentRef.dispatch("keydown", { target: field, key: "Tab", shiftKey: true })
  documentRef.dispatch("keydown", { target: field, key: "x", repeat: true })
  documentRef.dispatch("keydown", { target: field, key: "Control" })

  assert.deepEqual(instance.snapshot().filter((event) => event.type === "key").map((event) => event.key), ["Enter", "Escape", "Tab", "Backspace", "Delete", "Ctrl+s", "Shift+Tab"])
  assert.match(formatReproductionSteps(instance.snapshot()), /Pressed Enter/)
  assert.match(formatReproductionSteps(instance.snapshot()), /Pressed Ctrl\+s/)
})

test("captures sanitized route changes and ignores query strings and fragments", () => {
  const { instance, documentRef, locationRef } = recorder()
  const button = new FakeElement("button", { text: "Reload current view" })
  documentRef.dispatch("click", { target: button })
  locationRef.pathname = "/documents/42?auth=private#section"
  documentRef.dispatch("turbo:load")
  instance.recordNavigation("/share/AbCdEf1234567890GhIjKlMn?token=private#secret")

  assert.deepEqual(instance.snapshot().filter((event) => event.type === "navigate").map((event) => event.path), [
    "/documents/42",
    "/share/[REDACTED]"
  ])
})

test("ignores report UI activity and formatter noise while retaining ordered actions", () => {
  const { instance, documentRef } = recorder()
  const reportButton = new FakeElement("button", { text: "Report Bug", attributes: { "data-bug-report-ignore": "" } })
  const newButton = new FakeElement("button", { text: "New Document" })
  documentRef.dispatch("click", { target: reportButton })
  documentRef.dispatch("click", { target: newButton })
  instance.record({ type: "mousemove", x: 20, y: 10 }, 4)
  instance.record({ type: "scroll", y: 99 }, 5)
  instance.record({ type: "key", key: "Enter" }, 6)

  const steps = formatReproductionSteps(instance.snapshot())
  assert.match(steps, /1\. Navigated to "\/documents\/42"/)
  assert.match(steps, /2\. Clicked "New Document"/)
  assert.match(steps, /3\. Pressed Enter/)
  assert.doesNotMatch(steps, /Report Bug|mousemove|scroll/)
})

test("captures paste actions without reading clipboard contents and pauses on the reporter", () => {
  const { instance, documentRef } = recorder()
  const field = new FakeElement("textarea", { labels: [{ textContent: "Notes" }] })
  documentRef.dispatch("beforeinput", { target: field, inputType: "insertFromPaste", data: "clipboard-secret" })
  instance.pause()
  instance.recordTyping(field, "report form value")

  assert.equal(JSON.stringify(instance.events).includes("clipboard-secret"), false)
  assert.equal(JSON.stringify(instance.events).includes("report form value"), false)
  assert.match(formatReproductionSteps(instance.snapshot()), /Pasted text into notes field \(clipboard contents omitted\)/)
})
