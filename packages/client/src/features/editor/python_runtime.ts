import {
  runPythonWorkerRequest,
  type WorkerExecutionResult,
  type WorkerRenderFrame,
  type WorkerSliderSpec,
  type WorkerThemeConfig
} from "./python_worker.js"

export const PYTHON_CONTAINER_SELECTOR = ".elef-python-block"
export const PYTHON_ERROR_CLASS = "elef-python-error"
export const PYTHON_EXECUTION_TIMEOUT_MS = 10_000

export type PythonThemeConfig = WorkerThemeConfig
export type PythonSliderSpec = WorkerSliderSpec
export type PythonRenderFrame = WorkerRenderFrame
export type PythonExecutionResult = WorkerExecutionResult

export type PythonExecutor = (
  code: string,
  theme: PythonThemeConfig,
  options?: { signal?: AbortSignal; runtimeBaseUrl?: string }
) => Promise<PythonExecutionResult>

const TRANSPARENT_BACKGROUNDS = ["transparent", "rgba(0, 0, 0, 0)"]
const DARK_LUMINANCE_THRESHOLD = 0.5

const ALLOWED_SVG_TAGS = new Set([
  "SVG",
  "G",
  "PATH",
  "RECT",
  "CIRCLE",
  "ELLIPSE",
  "LINE",
  "POLYLINE",
  "POLYGON",
  "TEXT",
  "TSPAN",
  "DEFS",
  "LINEARGRADIENT",
  "RADIALGRADIENT",
  "STOP",
  "CLIPPATH",
  "MASK",
  "PATTERN",
  "MARKER",
  "SYMBOL",
  "USE",
  "TITLE",
  "DESC",
  "METADATA",
  "FILTER",
  "FEGAUSSIANBLUR",
  "FEOFFSET",
  "FEBLEND",
  "FECOLORMATRIX",
  "FECOMPONENTTRANSFER",
  "FECOMPOSITE",
  "FECONVOLVEMATRIX",
  "FEDIFFUSELIGHTING",
  "FEDISPLACEMENTMAP",
  "FEDROPSHADOW",
  "FEFLOOD",
  "FEFUNCA",
  "FEFUNCB",
  "FEFUNCG",
  "FEFUNCR",
  "FEMERGE",
  "FEMERGENODE",
  "FEMORPHOLOGY",
  "FEPOINTLIGHT",
  "FESPECULARLIGHTING",
  "FESPOTLIGHT",
  "FETILE",
  "FETURBULENCE"
])

const ALLOWED_TABLE_TAGS = new Set([
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TH",
  "TD",
  "CAPTION",
  "SPAN",
  "CODE",
  "STRONG",
  "EM",
  "B",
  "I",
  "BR"
])

let executionCache = new Map<string, Promise<PythonExecutionResult>>()
let customExecutor: PythonExecutor | null = null
let executionTimeoutMs = PYTHON_EXECUTION_TIMEOUT_MS
let workerInstance: Worker | null = null
let workerRequestId = 0
let workerPending = new Map<
  number,
  {
    resolve: (result: PythonExecutionResult) => void
    timer: ReturnType<typeof setTimeout>
  }
>()
let workerMessageCount = 0

export function getPythonWorkerMessageCount(): number {
  return workerMessageCount
}

export function resetPythonWorkerMessageCount(): void {
  workerMessageCount = 0
}

export function clearPythonExecutionCache(): void {
  executionCache.clear()
}

export function setPythonExecutorForTests(executor: PythonExecutor | null): void {
  customExecutor = executor
  clearPythonExecutionCache()
}

export function setPythonExecutionTimeoutForTests(timeoutMs: number): void {
  executionTimeoutMs = timeoutMs > 0 ? timeoutMs : PYTHON_EXECUTION_TIMEOUT_MS
}

function timeoutErrorMessage(ms = executionTimeoutMs): string {
  const seconds = ms / 1000
  if (Number.isInteger(seconds)) {
    return `Execution timed out after ${seconds} second${seconds === 1 ? "" : "s"}.`
  }
  return `Execution timed out after ${ms}ms.`
}

export function terminatePythonWorker(reason = timeoutErrorMessage()): void {
  if (workerInstance) {
    try {
      workerInstance.terminate()
    } catch {
      // Ignore termination errors.
    }
    workerInstance = null
  }
  for (const [, pending] of workerPending) {
    clearTimeout(pending.timer)
    pending.resolve({
      ok: false,
      frames: [],
      slider: null,
      error: reason
    })
  }
  workerPending.clear()
}

function isElementNode(node: unknown): node is HTMLElement {
  return Boolean(node && typeof node === "object" && (node as { nodeType?: number }).nodeType === 1)
}

export function pythonContainers(root: Document | Element): HTMLElement[] {
  const candidates: HTMLElement[] = []
  if (isElementNode(root) && typeof root.matches === "function" && root.matches(PYTHON_CONTAINER_SELECTOR) && !root.dataset?.processed) {
    candidates.push(root)
  }
  if (root && typeof root.querySelectorAll === "function") {
    candidates.push(
      ...[...root.querySelectorAll<HTMLElement>(PYTHON_CONTAINER_SELECTOR)].filter(
        (container) => !container.dataset?.processed
      )
    )
  }
  return candidates
}

export function pythonWorkerUrl(): string | null {
  if (typeof document === "undefined") return null
  const importmap = document.querySelector('script[type="importmap"]')
  if (importmap) {
    try {
      const parsed = JSON.parse(importmap.textContent || "{}") as { imports?: Record<string, string> }
      const mappedUrl = parsed.imports?.["@elef/client/python-worker"]
      if (mappedUrl) return mappedUrl
    } catch {
      // Static desktop host supplies its packaged worker through a meta tag.
    }
  }
  return document.querySelector<HTMLMetaElement>('meta[name="elef-python-worker-url"]')?.content || null
}

export function pythonRuntimeBaseUrl(): string {
  const globalBase = (globalThis as { __ELEF_PYTHON_RUNTIME_BASE__?: string }).__ELEF_PYTHON_RUNTIME_BASE__
  if (typeof globalBase === "string" && globalBase.trim()) return globalBase.trim()
  if (typeof document === "undefined") return "/python-runtime/"
  return (
    document.querySelector<HTMLMetaElement>('meta[name="elef-python-runtime-base"]')?.content ||
    "/python-runtime/"
  )
}

function rgbLuminance(rgbString: string): number | null {
  const channels = (rgbString.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
  if (channels.length !== 3 || channels.some((channel) => Number.isNaN(channel))) return null
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => channel / 255)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function opaqueBackground(element: Element | Document | null | undefined): string {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return "rgb(252, 250, 245)"
  }
  let node: Element | null = isElementNode(element) && element.isConnected ? element : null
  while (node && node.nodeType === 1) {
    const { backgroundColor } = window.getComputedStyle(node)
    if (
      backgroundColor &&
      !TRANSPARENT_BACKGROUNDS.includes(backgroundColor) &&
      !backgroundColor.endsWith(", 0)")
    ) {
      return backgroundColor
    }
    node = node.parentElement
  }
  if (typeof document !== "undefined" && document.body) {
    return window.getComputedStyle(document.body).backgroundColor || "rgb(252, 250, 245)"
  }
  return "rgb(252, 250, 245)"
}

function surfaceIsDark(element: Element | Document | null | undefined): boolean {
  if (isElementNode(element) && typeof element.closest === "function") {
    const explicitTheme = element.closest(
      ".work-theme-dark, .document-theme-dark, .slides-theme-dark, .work-theme-light, .document-theme-light, .slides-theme-light"
    )
    if (explicitTheme) {
      return (
        explicitTheme.classList.contains("work-theme-dark") ||
        explicitTheme.classList.contains("document-theme-dark") ||
        explicitTheme.classList.contains("slides-theme-dark")
      )
    }
  }
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    let node: Element | null = isElementNode(element) && element.isConnected ? element : null
    while (node && node.nodeType === 1 && node !== document.body) {
      const style = window.getComputedStyle(node)
      if (
        style.backgroundColor &&
        !TRANSPARENT_BACKGROUNDS.includes(style.backgroundColor) &&
        !style.backgroundColor.endsWith(", 0)")
      ) {
        const lum = rgbLuminance(style.backgroundColor)
        if (lum !== null) return lum < DARK_LUMINANCE_THRESHOLD
      }
      if (style.backgroundImage && style.backgroundImage !== "none") {
        const textLum = rgbLuminance(style.color || "")
        if (textLum !== null) return textLum > DARK_LUMINANCE_THRESHOLD
      }
      node = node.parentElement
    }
  }
  const lum = rgbLuminance(opaqueBackground(element))
  return lum !== null ? lum < DARK_LUMINANCE_THRESHOLD : false
}

export function pythonThemeConfig(element: Element | Document | null | undefined): PythonThemeConfig {
  const hasComputed =
    typeof window !== "undefined" &&
    typeof window.getComputedStyle === "function" &&
    typeof document !== "undefined" &&
    Boolean(document.body)
  const target = isElementNode(element) && element.isConnected ? element : hasComputed ? document.body : null
  const style = target && hasComputed ? window.getComputedStyle(target) : null
  const token = (name: string, fallback: string): string => style?.getPropertyValue(name).trim() || fallback
  const darkMode = surfaceIsDark(element)
  const fontFamily = token("--oradia-sans", "sans-serif")
  const background = token("--oradia-slate-950", "#11161a")

  if (darkMode) {
    return {
      darkMode: true,
      fontFamily,
      background,
      surface: token("--oradia-slate-800", "#202c32"),
      surfaceAlt: token("--oradia-slate-900", "#182126"),
      ink: token("--oradia-ink", "#e9eee9"),
      muted: token("--oradia-muted", "#aab7b1"),
      accent: token("--oradia-green", "#9fc5a9"),
      line: token("--oradia-slate-700", "#304047")
    }
  }

  return {
    darkMode: false,
    fontFamily,
    background,
    surface: token("--oradia-paper-bright", "#fcfaf5"),
    surfaceAlt: token("--oradia-paper", "#f5f0e7"),
    ink: token("--oradia-paper-ink", "#252a27"),
    muted: token("--oradia-paper-muted", "#68716b"),
    accent: token("--oradia-green-deep", "#4f8b68"),
    line: token("--oradia-paper-line", "#d8d0c2")
  }
}

export function normalizePythonCode(code: string): string {
  return code.replace(/\r\n/g, "\n").trimEnd()
}

function cacheKeyFor(code: string, theme: PythonThemeConfig): string {
  return `${normalizePythonCode(code)}\0${theme.darkMode ? "dark" : "light"}\0${theme.surface}\0${theme.accent}`
}

function ensureWorker(workerUrl: string): Worker {
  if (workerInstance) return workerInstance
  const worker = new Worker(workerUrl, { type: "module" })
  worker.addEventListener("message", (event: MessageEvent<{ id?: number; result?: PythonExecutionResult }>) => {
    const id = event.data?.id
    if (typeof id !== "number") return
    const pending = workerPending.get(id)
    if (!pending) return
    workerPending.delete(id)
    clearTimeout(pending.timer)
    pending.resolve(
      event.data?.result ?? {
        ok: false,
        frames: [],
        slider: null,
        error: "Worker returned an empty Python result."
      }
    )
  })
  worker.addEventListener("error", (event: ErrorEvent) => {
    const message = event.message || "Python worker crashed."
    for (const [, pending] of workerPending) {
      clearTimeout(pending.timer)
      pending.resolve({
        ok: false,
        frames: [],
        slider: null,
        error: message
      })
    }
    workerPending.clear()
    try {
      worker.terminate()
    } catch {
      // Ignore cleanup errors.
    }
    if (workerInstance === worker) workerInstance = null
  })
  workerInstance = worker
  return worker
}

async function executeWithTimeout(
  code: string,
  theme: PythonThemeConfig
): Promise<PythonExecutionResult> {
  const globalOverride = (globalThis as { __ELEF_PYTHON_EXECUTOR__?: PythonExecutor }).__ELEF_PYTHON_EXECUTOR__
  const activeExecutor = customExecutor ?? globalOverride ?? null
  const runtimeBaseUrl = pythonRuntimeBaseUrl()

  if (activeExecutor) {
    workerMessageCount += 1
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<PythonExecutionResult>((resolve) => {
      const timeoutMsg = timeoutErrorMessage(executionTimeoutMs)
      timer = setTimeout(() => {
        controller.abort()
        resolve({
          ok: false,
          frames: [],
          slider: null,
          error: timeoutMsg
        })
      }, executionTimeoutMs)
    })
    try {
      const execPromise = Promise.resolve(
        activeExecutor(code, theme, { signal: controller.signal, runtimeBaseUrl })
      ).catch((error: unknown) => ({
        ok: false,
        frames: [],
        slider: null,
        error: error instanceof Error ? error.message : String(error)
      }))
      return await Promise.race([execPromise, timeoutPromise])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const workerUrl = pythonWorkerUrl()
  if (workerUrl && typeof Worker === "function") {
    return new Promise<PythonExecutionResult>((resolve) => {
      let worker: Worker
      try {
        worker = ensureWorker(workerUrl)
      } catch {
        workerMessageCount += 1
        runPythonWorkerRequest(code, theme, runtimeBaseUrl).then(resolve, (error: unknown) =>
          resolve({
            ok: false,
            frames: [],
            slider: null,
            error: error instanceof Error ? error.message : String(error)
          })
        )
        return
      }
      workerRequestId += 1
      const id = workerRequestId
      workerMessageCount += 1
      const timeoutMsg = timeoutErrorMessage(executionTimeoutMs)
      const timer = setTimeout(() => {
        workerPending.delete(id)
        terminatePythonWorker(timeoutMsg)
        resolve({
          ok: false,
          frames: [],
          slider: null,
          error: timeoutMsg
        })
      }, executionTimeoutMs)
      workerPending.set(id, { resolve, timer })
      worker.postMessage({
        id,
        type: "run",
        code,
        theme,
        runtimeBaseUrl
      })
    })
  }

  workerMessageCount += 1
  return await runPythonWorkerRequest(code, theme, runtimeBaseUrl)
}

export async function runPythonCode(
  code: string,
  element: Element | Document | null | undefined,
  options: { force?: boolean } = {}
): Promise<PythonExecutionResult> {
  const normalizedCode = normalizePythonCode(code)
  const theme = pythonThemeConfig(element)
  const key = cacheKeyFor(normalizedCode, theme)
  if (options.force) {
    executionCache.delete(key)
  }
  const cached = executionCache.get(key)
  if (cached) return cached

  const pending = executeWithTimeout(normalizedCode, theme).then((result) => {
    if (!result.ok && result.error?.includes("timed out")) {
      executionCache.delete(key)
    }
    return result
  })
  executionCache.set(key, pending)
  return pending
}

function hasUnsafeUrlReference(value: string): boolean {
  const matches = value.match(/url\s*\([^)]*\)/gi)
  if (!matches) return false
  return matches.some((token) => !/^url\(\s*['"]?#[A-Za-z0-9_.:-]+['"]?\s*\)$/i.test(token.trim()))
}

export function sanitizePythonSvg(svgMarkup: string, doc: Document): Element | null {
  const template = doc.createElement("template")
  template.innerHTML = typeof svgMarkup === "string" ? svgMarkup.trim() : ""
  const svg = template.content.querySelector("svg")
  if (!svg) return null

  const elements: Element[] = [svg, ...svg.querySelectorAll("*")]

  for (const el of elements) {
    const tag = el.tagName.toUpperCase()
    if (!ALLOWED_SVG_TAGS.has(tag)) {
      el.remove()
      continue
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction") {
        el.removeAttribute(attr.name)
        continue
      }
      if (name === "href" || name === "xlink:href") {
        if (!/^#[A-Za-z0-9_.:-]+$/.test(value)) {
          el.removeAttribute(attr.name)
        }
        continue
      }
      if (hasUnsafeUrlReference(value)) {
        el.removeAttribute(attr.name)
        continue
      }
      if (name === "style" && /(?:@import|expression\s*\(|javascript:|data:|-moz-binding)/i.test(value)) {
        el.removeAttribute(attr.name)
      }
    }
  }
  return svg
}

export function sanitizePythonTable(tableMarkup: string, doc: Document): DocumentFragment {
  const template = doc.createElement("template")
  template.innerHTML = typeof tableMarkup === "string" ? tableMarkup : ""
  const elements: Element[] = [...template.content.querySelectorAll("*")]

  for (const el of elements) {
    const tag = el.tagName.toUpperCase()
    if (!ALLOWED_TABLE_TAGS.has(tag)) {
      el.remove()
      continue
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (name === "class" || name === "colspan" || name === "rowspan" || name === "scope" || name === "aria-label") {
        continue
      }
      if (name === "style" && ["TR", "TH", "TD"].includes(tag) && /^text-align\s*:\s*(?:left|center|right)\s*;?$/i.test(value)) {
        continue
      }
      el.removeAttribute(attr.name)
    }
  }
  return template.content
}

function stopInteractiveEventPropagation(element: HTMLElement): void {
  const events = ["pointerdown", "mousedown", "touchstart", "click", "dblclick", "keydown"]
  for (const eventName of events) {
    element.addEventListener(eventName, (event) => {
      event.stopPropagation()
    })
  }
}

function buildFrameElement(frame: PythonRenderFrame, index: number, active: boolean, doc: Document): HTMLElement {
  const frameEl = doc.createElement("div")
  frameEl.className = "elef-python-frame"
  frameEl.dataset.frameIndex = String(index)
  if (frame.value !== null && frame.value !== undefined) {
    frameEl.dataset.sliderValue = String(frame.value)
  }
  frameEl.hidden = !active

  if (frame.figuresSvg && frame.figuresSvg.length > 0) {
    const figuresWrap = doc.createElement("div")
    figuresWrap.className = "elef-python-figures"
    for (const rawSvg of frame.figuresSvg) {
      const cleanSvg = sanitizePythonSvg(rawSvg, doc)
      if (cleanSvg) figuresWrap.appendChild(cleanSvg)
    }
    if (figuresWrap.childNodes.length > 0) {
      frameEl.appendChild(figuresWrap)
    }
  }

  if (frame.dataframeHtml) {
    const tableWrap = doc.createElement("div")
    tableWrap.className = "elef-python-dataframe-wrap"
    tableWrap.appendChild(sanitizePythonTable(frame.dataframeHtml, doc))
    frameEl.appendChild(tableWrap)
  }

  if (frame.stdout && frame.stdout.trim().length > 0) {
    const stdoutEl = doc.createElement("pre")
    stdoutEl.className = "elef-python-stdout"
    stdoutEl.textContent = frame.stdout.replace(/\n$/, "")
    frameEl.appendChild(stdoutEl)
  }

  return frameEl
}

export function mountPythonExecutionResult(container: HTMLElement, result: PythonExecutionResult): void {
  const doc = container.ownerDocument || document
  const outputTarget = container.querySelector<HTMLElement>(".elef-python-output") ?? container
  outputTarget.replaceChildren()
  container.classList.remove(PYTHON_ERROR_CLASS)
  outputTarget.classList.remove(PYTHON_ERROR_CLASS)

  if (!result.ok) {
    container.classList.add(PYTHON_ERROR_CLASS)
    outputTarget.classList.add(PYTHON_ERROR_CLASS)
    const errorPre = doc.createElement("pre")
    errorPre.className = "elef-python-traceback"
    errorPre.setAttribute("role", "alert")
    errorPre.textContent = result.error || "Python execution failed."
    outputTarget.appendChild(errorPre)
    return
  }

  const slider = result.slider
  const frames = result.frames || []
  let activeIndex = 0
  if (slider && frames.length > 0) {
    const foundIdx = frames.findIndex((f) => f.value === slider.defaultValue)
    if (foundIdx >= 0) activeIndex = foundIdx
  }

  const frameElements = frames.map((frame, idx) =>
    buildFrameElement(frame, idx, idx === activeIndex, doc)
  )

  if (slider && frames.length > 0) {
    const controls = doc.createElement("div")
    controls.className = "elef-python-controls"
    stopInteractiveEventPropagation(controls)

    const label = doc.createElement("label")
    label.className = "elef-python-slider-label"

    const titleSpan = doc.createElement("span")
    titleSpan.className = "elef-python-slider-title"
    titleSpan.textContent = slider.label

    const input = doc.createElement("input")
    input.type = "range"
    input.className = "elef-python-slider"
    input.min = String(slider.min)
    input.max = String(slider.max)
    input.step = String(slider.step)
    input.value = String(slider.defaultValue)
    input.setAttribute("aria-label", slider.label)

    const valueOutput = doc.createElement("output")
    valueOutput.className = "elef-python-slider-value"
    valueOutput.textContent = String(slider.defaultValue)

    const syncFrame = (): void => {
      const numeric = Number(input.value)
      let bestIndex = 0
      let bestDiff = Infinity
      slider.values.forEach((candidate, idx) => {
        const diff = Math.abs(candidate - numeric)
        if (diff < bestDiff) {
          bestDiff = diff
          bestIndex = idx
        }
      })
      const chosenValue = slider.values[bestIndex] ?? numeric
      valueOutput.textContent = String(chosenValue)
      frameElements.forEach((el, idx) => {
        el.hidden = idx !== bestIndex
      })
    }

    input.addEventListener("input", (event) => {
      event.stopPropagation()
      syncFrame()
    })
    input.addEventListener("change", (event) => {
      event.stopPropagation()
      syncFrame()
    })

    label.append(titleSpan, input, valueOutput)
    controls.appendChild(label)
    outputTarget.appendChild(controls)
  }

  const framesContainer = doc.createElement("div")
  framesContainer.className = "elef-python-frames"
  for (const frameEl of frameElements) {
    framesContainer.appendChild(frameEl)
  }
  outputTarget.appendChild(framesContainer)
}

export async function renderPythonBlock(
  container: HTMLElement,
  options: { force?: boolean; sourceOverride?: string } = {}
): Promise<PythonExecutionResult> {
  const sourceEl = container.querySelector<HTMLElement>(".elef-python-source")
  const code = options.sourceOverride ?? sourceEl?.textContent ?? ""
  container.dataset.processed = "loading"
  const result = await runPythonCode(code, container, { force: Boolean(options.force) })
  if (container.isConnected || !container.ownerDocument?.defaultView) {
    mountPythonExecutionResult(container, result)
  }
  container.dataset.processed = "true"
  return result
}

export async function renderPythonBlocks(root: Document | Element): Promise<boolean> {
  const containers = pythonContainers(root)
  if (!containers.length) return false
  await Promise.all(containers.map((container) => renderPythonBlock(container)))
  return true
}
