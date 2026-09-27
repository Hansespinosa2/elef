export const MAX_EVENT_AGE_MS = 60_000
export const MAX_EVENT_COUNT = 500

const TYPING_COMPACTION_MS = 1_500
const MAX_TYPED_TEXT_LENGTH = 500
const PRUNE_INTERVAL_MS = 5_000
const SENSITIVE_NAME = /(?:pass(?:word|code)?|secret|token|api[_ -]?key|access[_ -]?key|credential|auth(?:entication|orization)?|e-?mail|phone|telephone|mobile|credit[_ -]?card|card[_ -]?(?:number|cvc|cvv|security)|cc[_ -]?(?:num(?:ber)?|csc|cvc|cvv|exp)|security[_ -]?code|\bcvv\b|\bcvc\b|\bcsc\b|\bpan\b|social[_ -]?security|\bssn\b)/i
const SENSITIVE_AUTOCOMPLETE = /^(?:current-password|new-password|one-time-code|cc-(?:number|csc|exp|exp-month|exp-year|name|type))$/i
const IGNORE_SELECTOR = "[data-bug-report-ignore], [data-bug-reporting-ui]"
const INTERACTIVE_SELECTOR = "button, a[href], input, textarea, select, summary, [role='button'], [role='link'], [contenteditable='true'], [data-action], [tabindex]:not([tabindex='-1'])"

function elementFor(target) {
  if (target?.nodeType === 3) return target.parentElement
  return target?.nodeType === 1 ? target : null
}

function cleanLabel(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function attribute(element, name) {
  return cleanLabel(element?.getAttribute?.(name))
}

function roleFor(element) {
  const explicit = attribute(element, "role").slice(0, 30)
  if (explicit) return explicit
  const tag = element?.tagName?.toLowerCase()
  if (tag === "button" || tag === "summary") return "button"
  if (tag === "a") return "link"
  if (tag === "textarea") return "textbox"
  if (tag === "select") return "combobox"
  if (tag === "input") return attribute(element, "type") === "submit" ? "button" : "textbox"
  return element?.isContentEditable ? "textbox" : "element"
}

function isTextEntry(element) {
  if (!element) return false
  if (element.isContentEditable) return true
  const tag = element.tagName?.toLowerCase()
  if (tag === "textarea") return true
  if (tag !== "input") return false
  return !/^(?:button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(attribute(element, "type") || "text")
}

function associatedLabel(element) {
  const direct = cleanLabel(Array.from(element?.labels ?? []).map((label) => label.innerText || label.textContent).join(" "))
  if (direct) return direct

  const id = attribute(element, "id")
  if (!id) return ""
  const ownerDocument = element.ownerDocument
  const label = ownerDocument?.querySelector?.(`label[for="${globalThis.CSS?.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&")}"]`)
  return cleanLabel(label?.innerText || label?.textContent)
}

function hasSensitiveMetadata(element) {
  if (!element) return false
  if (attribute(element, "type").toLowerCase() === "password") return true
  if (["data-sensitive", "data-private", "data-secret", "aria-sensitive"].some((name) => element.hasAttribute?.(name))) return true

  const autocomplete = attribute(element, "autocomplete").split(/\s+/).filter(Boolean)
  if (autocomplete.some((token) => SENSITIVE_AUTOCOMPLETE.test(token))) return true

  return ["name", "id", "aria-label", "placeholder", "title", "class", "data-testid", "data-qa", "data-field"].some((name) =>
    SENSITIVE_NAME.test(attribute(element, name))
  )
}

export function isSensitiveField(target) {
  let element = elementFor(target)
  while (element) {
    if (isTextEntry(element) && hasSensitiveMetadata(element)) return true
    element = element.parentElement
  }
  return false
}

function textEntryName(element) {
  if (hasSensitiveMetadata(element)) {
    const metadata = ["type", "name", "id", "aria-label", "autocomplete", "placeholder", "title"].map((name) => attribute(element, name)).join(" ")
    if (/pass(?:word|code)/i.test(metadata)) return "password field"
    if (/(?:credit|card|cc[_ -]?|\bcv[vc]\b|\bcsc\b)/i.test(metadata)) return "payment details field"
    if (/(?:secret|token|api[_ -]?key|access[_ -]?key|credential)/i.test(metadata)) return "credential field"
    return "sensitive field"
  }

  const label = attribute(element, "aria-label") || associatedLabel(element) || attribute(element, "placeholder") || attribute(element, "name")
  const name = cleanLabel(label).slice(0, 80).replace(/\s+field$/i, "")
  if (name) return `${name[0].toLowerCase()}${name.slice(1)} field`
  if (element.isContentEditable) return "editor"
  return `${attribute(element, "type") || element.tagName.toLowerCase()} field`
}

function stableIdentifier(element) {
  const id = attribute(element, "id")
  const stable = (value) => value && value.length <= 80 && !/(?:\d{6,}|[0-9a-f]{8}-[0-9a-f-]{27,})/i.test(value)
  if (stable(id)) return `#${id}`

  for (const name of ["data-command-id", "data-document-id", "data-presentation-id", "data-editor-slide-id", "data-source-id", "data-target-id", "data-command-palette-shortcut", "data-type"]) {
    const value = attribute(element, name)
    if (stable(value)) return `${name} "${value}"`
  }

  for (const name of ["data-testid", "data-test", "data-qa"]) {
    const value = attribute(element, name)
    if (stable(value)) return `${name} "${value}"`
  }
  return ""
}

export function describeTarget(target) {
  let element = elementFor(target)
  if (!element) return "element"
  if (!element.matches?.(INTERACTIVE_SELECTOR)) element = element.closest?.(INTERACTIVE_SELECTOR) || element

  if (isTextEntry(element)) return textEntryName(element)

  const role = roleFor(element)
  const label = attribute(element, "aria-label") || associatedLabel(element) || cleanLabel(element.innerText || element.textContent)
  if (label) {
    const quoted = JSON.stringify(label.slice(0, 100))
    if (role === "button" || role === "link") {
      const toolbar = element.closest?.("[role='toolbar'], .editor-toolbar, .presentation-toolbar, .document-toolbar")
      return toolbar ? `toolbar ${role} ${quoted}` : quoted
    }
    return `${role} ${quoted}`
  }

  const identifier = stableIdentifier(element)
  if (identifier) return `${role} ${identifier}`
  if (role !== "element") return role
  return `${element.tagName?.toLowerCase() || "unknown"} element`
}

function safePathname(value) {
  let pathname = value
  try {
    pathname = new URL(String(value), "https://elef.invalid").pathname
  } catch (_error) {
    pathname = "/"
  }
  return pathname
    .split("/")
    .map((segment) => {
      if (/^(?:[a-f0-9]{32,}|[a-f0-9]{8}-[a-f0-9-]{27,}|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}|[a-zA-Z0-9_-]{24,})$/i.test(segment)) return "[REDACTED]"
      if (segment.length > 80) return "[REDACTED]"
      return segment
    })
    .join("/")
    .slice(0, 500) || "/"
}

function copyEvent(event) {
  return { ...event }
}

export class BugReportEventRecorder {
  constructor({ documentRef = globalThis.document, windowRef = globalThis.window, locationRef = globalThis.location, now = () => Date.now(), maxAgeMs = MAX_EVENT_AGE_MS, maxCount = MAX_EVENT_COUNT } = {}) {
    this.document = documentRef
    this.window = windowRef
    this.location = locationRef
    this.now = now
    this.maxAgeMs = maxAgeMs
    this.maxCount = maxCount
    this.events = []
    this.paused = false
    this.started = false
    this.lastPath = null

    this.onClick = (event) => this.recordClick(event)
    this.onBeforeInput = (event) => this.recordBeforeInput(event)
    this.onKeyDown = (event) => this.recordKeyDown(event)
    this.onRouteChange = () => this.recordNavigation(this.location?.pathname || "/")
    this.expiryTimer = null
  }

  start() {
    if (this.started || !this.document?.addEventListener) return this
    this.started = true
    this.document.addEventListener("click", this.onClick, true)
    this.document.addEventListener("beforeinput", this.onBeforeInput, true)
    this.document.addEventListener("keydown", this.onKeyDown, true)
    this.document.addEventListener("turbo:load", this.onRouteChange)
    this.window?.addEventListener?.("popstate", this.onRouteChange)
    this.expiryTimer = globalThis.setInterval(() => this.prune(), PRUNE_INTERVAL_MS)
    this.expiryTimer?.unref?.()
    this.recordNavigation(this.location?.pathname || "/")
    return this
  }

  stop() {
    if (!this.started) return
    this.document.removeEventListener("click", this.onClick, true)
    this.document.removeEventListener("beforeinput", this.onBeforeInput, true)
    this.document.removeEventListener("keydown", this.onKeyDown, true)
    this.document.removeEventListener("turbo:load", this.onRouteChange)
    this.window?.removeEventListener?.("popstate", this.onRouteChange)
    if (this.expiryTimer !== null) globalThis.clearInterval(this.expiryTimer)
    this.expiryTimer = null
    this.started = false
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
  }

  snapshot() {
    this.prune()
    return this.events.map(copyEvent)
  }

  recordClick(event) {
    const element = elementFor(event?.target)
    if (!element || this.ignored(element) || !element.closest?.(INTERACTIVE_SELECTOR)) return
    this.record({ type: "click", target: describeTarget(element) })
  }

  recordBeforeInput(event) {
    const element = elementFor(event?.target)
    if (!element || this.ignored(element) || !isTextEntry(element)) return

    const inputType = String(event.inputType || "")
    if (inputType === "insertFromPaste" || inputType === "insertFromDrop") {
      this.record({ type: "paste", target: textEntryName(element) })
      return
    }
    if (inputType !== "insertText") return

    const text = typeof event.data === "string" ? event.data : ""
    if (!text) return
    this.recordTyping(element, text)
  }

  recordTyping(target, text) {
    if (this.paused) return

    const element = elementFor(target)
    if (!element || this.ignored(element)) return
    const redacted = isSensitiveField(element)
    const targetName = textEntryName(element)
    const timestamp = this.now()
    const previous = this.events[this.events.length - 1]

    if (previous?.type === "typing" && previous.target === targetName && previous.redacted === redacted && timestamp - previous.at <= TYPING_COMPACTION_MS) {
      if (!redacted) {
        const combined = previous.text + String(text)
        previous.text = combined.length > MAX_TYPED_TEXT_LENGTH
          ? `${combined.slice(0, MAX_TYPED_TEXT_LENGTH - 1)}…`
          : combined
      }
      previous.at = timestamp
      this.prune(timestamp)
      return
    }

    this.record({
      type: "typing",
      target: targetName,
      text: redacted ? "[REDACTED]" : String(text).slice(0, MAX_TYPED_TEXT_LENGTH),
      redacted
    }, timestamp)
  }

  recordKeyDown(event) {
    const element = elementFor(event?.target)
    if (!element || this.ignored(element) || event.repeat || this.paused) return

    const key = String(event.key || "").slice(0, 32)
    if (!key || ["Shift", "Control", "Alt", "Meta", "OS", "CapsLock", "NumLock", "ScrollLock"].includes(key)) return

    const modifier = event.ctrlKey || event.metaKey || event.altKey
    const special = ["Enter", "Escape", "Tab", "Backspace", "Delete"].includes(key)
    if (!modifier && !special) return

    const prefix = []
    if (event.ctrlKey) prefix.push("Ctrl")
    if (event.altKey) prefix.push("Alt")
    if (event.shiftKey && (modifier || special)) prefix.push("Shift")
    if (event.metaKey) prefix.push("Meta")
    const normalizedKey = key === "Escape" ? "Escape" : key
    const shortcut = [...prefix, normalizedKey].join("+")
    this.record({ type: "key", key: shortcut })
  }

  recordNavigation(path) {
    if (this.paused) return
    const pathname = safePathname(path)
    if (this.lastPath === pathname) return
    this.lastPath = pathname
    this.record({ type: "navigate", path: pathname })
  }

  record(event, timestamp = this.now()) {
    if (this.paused) return
    this.events.push({ ...event, at: timestamp })
    this.prune(timestamp)
  }

  prune(timestamp = this.now()) {
    const cutoff = timestamp - this.maxAgeMs
    this.events = this.events.filter((event) => event.at >= cutoff)
    if (this.events.length > this.maxCount) this.events.splice(0, this.events.length - this.maxCount)
  }

  ignored(element) {
    return Boolean(element.closest?.(IGNORE_SELECTOR))
  }
}

export function formatReproductionSteps(events) {
  const actions = []

  for (const event of events || []) {
    if (!event || typeof event !== "object") continue
    if (event.type === "navigate") {
      const path = safePathname(event.path || "/")
      if (actions.at(-1)?.type === "navigate" && actions.at(-1).path === path) continue
      actions.push({ type: "navigate", path })
      continue
    }
    if (event.type === "click" && event.target) {
      actions.push({ type: "click", target: cleanLabel(event.target) })
      continue
    }
    if (event.type === "typing" && event.target) {
      const current = actions.at(-1)
      if (current?.type === "typing" && current.target === event.target && current.redacted === Boolean(event.redacted)) {
        if (!current.redacted) current.text += String(event.text || "")
      } else {
        actions.push({ type: "typing", target: cleanLabel(event.target), text: event.redacted ? "[REDACTED]" : String(event.text || ""), redacted: Boolean(event.redacted) })
      }
      continue
    }
    if (event.type === "paste" && event.target) actions.push({ type: "paste", target: cleanLabel(event.target) })
    if (event.type === "key" && event.key) actions.push({ type: "key", key: cleanLabel(event.key) })
  }

  const lines = actions.map((event) => {
    if (event.type === "navigate") return `Navigated to ${JSON.stringify(event.path)}`
    if (event.type === "click") return `Clicked ${event.target}`
    if (event.type === "typing") {
      if (event.redacted) return `Typed into ${event.target} [REDACTED]`
      const text = JSON.stringify(event.text)
      return `Typed ${text}${event.target === "editor" ? "" : ` into ${event.target}`}`
    }
    if (event.type === "paste") return `Pasted text into ${event.target} (clipboard contents omitted)`
    return `Pressed ${event.key}`
  })

  if (lines.length === 0) lines.push("No interactions captured")
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n")
}

const sharedRecorderKey = Symbol.for("elef.bugReportEventRecorder")

export function sharedBugReportRecorder() {
  if (!globalThis[sharedRecorderKey]) {
    globalThis[sharedRecorderKey] = new BugReportEventRecorder().start()
  }
  return globalThis[sharedRecorderKey]
}
