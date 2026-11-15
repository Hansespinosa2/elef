// Desktop PDF content & parity suite: the exported PDF must carry the Work
// only, never app or editor chrome, at the exact web page size and pagination
// across both editor modes (`source` — the Stable macOS default — and `visual`)
// and across single-page and multi-page documents.
//
// Why the previous probe missed the blank 2-page document bug:
//   1. It loaded only `tailwind.css` + `file_library_host.css` and omitted the
//      layered `application.css` bundle (`components/documents.css`,
//      `components/editor.css`, `tokens.css`, `themes.css`, `base.css`).
//   2. It injected unpaginated `renderPreview()` output into a bare `<div
//      id="desktop-preview">` instead of mounting the real desktop host shell
//      (`desktop_host.html` + `renderEditorView`) and running the real
//      `document-pages` Stimulus pagination controller (`.document-surface
//      .is-paginated > .document-page-frame > .document-page`).
//   3. It tested neither `data-editor-mode="source"` nor multi-page documents.
//
// This suite closes every one of those gaps:
//   - Full host stylesheets (`file_library_host.css`, `tailwind.css`, and the
//     layered `application.css` via `readApplicationStylesheet()`).
//   - Real `desktop_host.html` + `renderEditorView` desktop shell DOM + real
//     `apps/web/app/views/documents/print.html.erb` web print DOM.
//   - Real `DocumentPagesController` Stimulus pagination in both hosts and both
//     `source` and `visual` editor modes.
//   - Real Chromium `page.pdf` extraction + per-page MediaBox checks + per-page
//     PNG raster ink verification + print-media computed layout/containment checks.
import { expect, test } from "@playwright/test"
import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inflateSync } from "node:zlib"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import { renderPreviewCore } from "@elef/renderer"
import { readApplicationStylesheet, renderPreview } from "./shared_helpers.js"

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SPEC_DIR, "../../../..")

const DESKTOP_HOST_HTML = await readFile(
  path.join(REPO_ROOT, "apps/web/app/views/desktop_host.html"),
  "utf8",
)

// Bundle the real Stimulus document-pages runtime + print helper once so pages
// execute the genuine shipped controller & editor view markup without external
// network/file URLs (matching the pattern in editor-mode-events.spec.js).
const RUNTIME_BUNDLE = (
  await build({
    stdin: {
      contents: `
        export { registerEditorRuntime } from "@elef/editor-runtime"
        export { flushDesktopPreviewForPrint, installPreviewHtml, renderEditorView } from "@elef/editor-runtime/test-internals"
        export { ALL_PRINT_MARKERS, mountPresentation, pausePrintVideos, printMarkerClasses, syncPrintPageSizeStyle } from "@elef/client"
      `,
      resolveDir: SPEC_DIR,
      loader: "js",
    },
    bundle: true,
    format: "esm",
    jsx: "automatic",
    platform: "browser",
    write: false,
    nodePaths: [
      path.join(REPO_ROOT, "apps/desktop/frontend/node_modules"),
      path.join(REPO_ROOT, "node_modules"),
    ],
  })
).outputFiles[0].text

const PRESENTATION_SOURCE = [
  "# Seed Title",
  "",
  "Hello from the seed work with **bold** and *italic* plus `code`.",
  "",
  "```md",
  "---",
  "fenced separator stays literal",
  "```",
  "",
  "| Left | Right |",
  "| --- | --- |",
  "| one | two |",
  "",
  "Equation $x^2$ inline.",
  "",
  `![Seed alt text](${PIXEL_PNG})`,
  "",
  "---",
  "",
  "# Second Slide",
  "",
  "## Left",
  "",
  "Left column text.",
  "",
  "## Right",
  "",
  "Right column text.",
  "",
].join("\n")

const DOCUMENT_SOURCE = [
  "# Document Title",
  "",
  "Flowing document paragraph one with **bold**.",
  "",
  "```js",
  "console.log(\"hi\")",
  "```",
  "",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "Equation $y = mx + b$.",
  "",
  `![Doc alt text](${PIXEL_PNG})`,
  "",
  "- one",
  "- two",
  "",
].join("\n")

const MULTI_PAGE_DOCUMENT_SOURCE = Array.from({ length: 18 }, (_, index) => {
  const n = index + 1
  return [
    `## Multi-Page Section ${n}`,
    "",
    `Paragraph ${n}: Offline-first Markdown authoring keeps plain folders as the source of truth while desktop and web print pipelines must agree on every A4 sheet.`,
    "",
  ].join("\n")
}).join("\n")

const PRESENTATION_WORK = [
  "Seed Title",
  "Hello from the seed work with",
  "fenced separator stays literal",
  "Seed alt text",
  "Second Slide",
  "Left column text.",
  "Right column text.",
]
const DOCUMENT_WORK = [
  "Document Title",
  "Flowing document paragraph one with",
  "Doc alt text",
]
// Editor & desktop shell chrome the fixed state must keep out of the PDF.
const PRESENTATION_CHROME = ["Add slide", "Slide 1", "Add block", "Move down", "Align", "Add image", "Export"]
const DOCUMENT_CHROME = ["Align", "Export", "SourcePaneLeakToken", "SaveDraftLeakToken"]

async function desktopStyles() {
  const host = await readFile(
    path.join(REPO_ROOT, "apps/web/app/assets/stylesheets/file_library_host.css"),
    "utf8",
  )
  const tailwind = await readFile(
    path.join(REPO_ROOT, "apps/web/app/assets/builds/tailwind.css"),
    "utf8",
  )
  const appCss = await readApplicationStylesheet()
  return `${host}\n${tailwind}\n${appCss}`
}

async function webStyles() {
  const tailwind = await readFile(
    path.join(REPO_ROOT, "apps/web/app/assets/builds/tailwind.css"),
    "utf8",
  )
  const appCss = await readApplicationStylesheet()
  return `${tailwind}\n${appCss}`
}

function styleOf() {
  return { theme: "light", typography: "book" }
}

function desktopShellHtml({ markers }) {
  const bodyClasses = ["elef-app", ...markers].join(" ")
  const stripped = DESKTOP_HOST_HTML
    .replace(/<link rel="stylesheet"[^>]*>\s*/gi, "")
    .replace(/<script type="module"[^>]*><\/script>\s*/gi, "")
    .replace("</head>", "<style>/*STYLES*/</style></head>")
    .replace('<body class="elef-app">', `<body class="${bodyClasses}" data-desktop-view="editor">`)
    .replace('<section id="work-view" class="work-view" hidden', '<section id="work-view" class="work-view"')
  return stripped
}

function webPrintHtml({ bareHtml, kind }) {
  const toolbar = `<div class="${kind === "document" ? "presentation-print-toolbar document-print-toolbar" : "presentation-print-toolbar"}"><button type="button">Save as PDF</button></div>`
  const main =
    kind === "document"
      ? `<main class="document-print work-theme-light work-typography-book document-theme-light document-typography-book">${toolbar}<div class="document-print-pages"><div class="document-reader document-theme-light document-typography-book work-theme-light work-typography-book" data-controller="document-pages mermaid-diagrams"><div class="document-surface" data-document-pages-target="surface">${bareHtml}</div></div></div></main>`
      : `<main class="presentation-print presentation-surface work-theme-light work-typography-book slides-presentation-book-light">${toolbar}<div class="slides presentation-print-slides">${bareHtml}</div></main>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>/*STYLES*/</style></head><body>${main}</body></html>`
}

async function mountDesktopShellAndPaginate(page, { kind, source, markers, editorMode, preparePrint = markers.length > 0 }) {
  const styles = await desktopStyles()
  const previewHtml = renderPreview({
    kind,
    source,
    style: styleOf(),
    title: "Probe work",
    allowRemoteMedia: false,
  }).html

  await page.goto("about:blank")
  await page.setViewportSize({ width: 1280, height: 840 })
  await page.setContent(desktopShellHtml({ markers }).replace("/*STYLES*/", () => styles))
  await page.evaluate(
    async ({ runtimeSource, kind, source, editorMode, previewHtml, preparePrint, markers }) => {
      const runtime = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(runtimeSource)}`)
      const form = document.querySelector("#desktop-editor-form")
      const editorMount = document.querySelector("#desktop-editor-mount")
      const exportMount = document.querySelector("#export-menu-mount")
      const workNotice = document.querySelector("#work-notice")
      exportMount.innerHTML = '<div class="export-menu"><button type="button">Export</button></div>'
      if (workNotice) {
        workNotice.hidden = false
        workNotice.textContent = "SaveDraftLeakToken"
      }
      document.querySelector(".desktop-save-note").textContent = "Desktop save note leak"
      form.dataset.editorMode = editorMode

      runtime.renderEditorView(editorMount, {
        kind,
        title: "Probe work",
        source,
        mode: editorMode,
        showTitle: true,
        showSubmit: false,
        showSaveStatus: false,
        persisted: false,
        ids: {
          field: "desktop-editor-field",
          source: "work-source",
          surface: "work-source-editor",
          label: "work-source-label",
          title: "desktop-editor-title",
          visualMode: "visual-mode",
          sourceMode: "source-mode",
          theme: "work-theme",
          typography: "work-typography",
          preview: "desktop-preview",
        },
      })
      document.querySelector("#desktop-editor-field")?.removeAttribute("data-controller")
      form.removeAttribute("data-controller")

      // Put visible text in .source-pane so any failure to hide the split
      // source column in source mode immediately leaks into extracted PDF text.
      const sourceSurface = document.querySelector(".source-pane .editor-surface")
      if (sourceSurface) sourceSurface.textContent = "SourcePaneLeakToken"

      const preview = document.querySelector("#desktop-preview")
      runtime.installPreviewHtml(preview, previewHtml)
      if (preparePrint) runtime.syncPrintPageSizeStyle(kind)
      if (markers.length > 0) document.body.classList.add(...markers)
      runtime.registerEditorRuntime()
    },
    { runtimeSource: RUNTIME_BUNDLE, kind, source, editorMode, previewHtml, preparePrint, markers },
  )

  if (kind === "document") {
    await page.waitForSelector('#desktop-preview [data-document-pages-target="surface"][data-document-pages-settled="true"]')
    if (preparePrint) {
      await page.evaluate(() => {
        document.querySelectorAll('#desktop-preview .document-page-frame.is-quiet, #desktop-preview .document-page-frame.is-sealed')
          .forEach((frame) => frame.classList.remove("is-quiet", "is-sealed"))
      })
    }
  }
  await page.evaluate(() => document.fonts.ready)
}

async function mountWebPrintAndPaginate(page, { kind, source }) {
  const styles = await webStyles()
  const bareHtml = renderPreviewCore({
    kind,
    source,
    style: styleOf(),
    title: "Probe work",
    allowRemoteMedia: false,
  }).html

  await page.goto("about:blank")
  await page.setViewportSize({ width: 1280, height: 840 })
  await page.setContent(webPrintHtml({ bareHtml, kind }).replace("/*STYLES*/", () => styles))
  await page.evaluate(async (runtimeSource) => {
    const surface = document.querySelector('.document-print [data-document-pages-target="surface"]')
    const docRoot = surface?.querySelector(":scope > .document")
    if (docRoot) {
      for (const outer of [...docRoot.querySelectorAll(":scope > .document-block")]) {
        const inner = outer.firstElementChild
        if (outer.childElementCount === 1 && inner?.classList.contains("document-block")) {
          outer.replaceWith(inner)
        }
      }
      docRoot.replaceWith(...docRoot.childNodes)
    }
    const runtime = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(runtimeSource)}`)
    runtime.registerEditorRuntime()
  }, RUNTIME_BUNDLE)
  if (kind === "document") {
    await page.waitForSelector('.document-print [data-document-pages-target="surface"][data-document-pages-settled="true"]')
  }
  await page.evaluate(() => document.fonts.ready)
}

async function pdfTextAndBoxes(page) {
  const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  expect(Buffer.from(bytes).subarray(0, 5).toString("latin1"), "expected real PDF bytes").toBe("%PDF-")
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
  let text = ""
  const pages = []
  for (let number = 1; number <= document.numPages; number += 1) {
    const content = await (await document.getPage(number)).getTextContent()
    const pageText = content.items.map((item) => item.str ?? "").join(" ")
    pages.push(pageText)
    text += `${pageText}\n`
  }
  const raw = Buffer.from(bytes).toString("latin1")
  const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(
    (match) => ({ width: Number(match[3]) - Number(match[1]), height: Number(match[4]) - Number(match[2]) }),
  )
  return { text, pages, boxes, pagesCount: document.numPages }
}

// Byte form of a PDF page's text: every whitespace run stripped, so the
// comparison is over content characters only (immune to ligature/kerning
// splits like "fi gure", which vary with the caption's host styles) while
// staying byte-exact on what each host put into the page.
function pageBytes(pageText) {
  return pageText.replace(/\s+/g, "")
}

// Minimal PNG decoder (8-bit non-interlaced RGB/RGBA, all filter types):
// computes ink counts per vertical [startY, endY) slice so both single-page
// and multi-page screenshots can assert that EVERY page painted real ink.
function pngInkByBands(buffer, bands = null) {
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString("latin1", pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === "IDAT") {
      idat.push(data)
    } else if (type === "IEND") {
      break
    }
    pos += 12 + length
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  expect(bitDepth, "expected an 8-bit Playwright screenshot").toBe(8)
  expect(channels, "expected an RGB/RGBA Playwright screenshot").toBeGreaterThan(0)
  expect(interlace, "expected a non-interlaced Playwright screenshot").toBe(0)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const resolvedBands = bands ?? [{ startY: 0, endY: height }]
  const counts = resolvedBands.map((band) => {
    const startY = Math.max(0, Math.min(height, band.startY))
    const endY = Math.max(startY, Math.min(height, band.endY))
    return { startY, endY, nonWhite: 0, dark: 0, pixels: Math.max(1, (endY - startY) * width) }
  })
  let previous = Buffer.alloc(stride)
  let cursor = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor]
    cursor += 1
    const line = raw.subarray(cursor, cursor + stride)
    cursor += stride
    const recon = Buffer.alloc(stride)
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? recon[i - channels] : 0
      const b = previous[i]
      const c = i >= channels ? previous[i - channels] : 0
      let value = line[i]
      if (filter === 1) value = (value + a) & 255
      else if (filter === 2) value = (value + b) & 255
      else if (filter === 3) value = (value + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      recon[i] = value
    }
    previous = recon
    let rowNonWhite = 0
    let rowDark = 0
    for (let x = 0; x < width; x += 1) {
      const r = recon[x * channels]
      const g = recon[x * channels + 1]
      const b = recon[x * channels + 2]
      if (r < 250 || g < 250 || b < 250) rowNonWhite += 1
      if (r < 128 && g < 128 && b < 128) rowDark += 1
    }
    for (const band of counts) {
      if (y >= band.startY && y < band.endY) {
        band.nonWhite += rowNonWhite
        band.dark += rowDark
      }
    }
  }
  return counts.map((band) => ({
    width,
    height: band.endY - band.startY,
    nonWhite: band.nonWhite,
    dark: band.dark,
    nonWhiteFraction: band.nonWhite / band.pixels,
  }))
}

async function printRasterInk(page, frameSelector = null) {
  await page.emulateMedia({ media: "print" })
  try {
    const bands = frameSelector
      ? await page.evaluate((selector) =>
          [...document.querySelectorAll(selector)].map((el) => {
            const rect = el.getBoundingClientRect()
            return {
              startY: Math.max(0, Math.round(rect.top)),
              endY: Math.max(0, Math.round(rect.bottom)),
            }
          }),
        frameSelector)
      : null
    const shot = await page.screenshot({ fullPage: true })
    return pngInkByBands(shot, bands)
  } finally {
    await page.emulateMedia({ media: null })
  }
}

function expectRealInk(ink, label) {
  expect(ink.nonWhiteFraction, `${label}: expected rendered content, got a blank raster`).toBeGreaterThan(0.001)
  expect(ink.dark, `${label}: expected dark text pixels, got a content-free raster`).toBeGreaterThan(1000)
}

for (const kind of ["presentation", "document"]) {
  const source = kind === "document" ? DOCUMENT_SOURCE : PRESENTATION_SOURCE
  const workStrings = kind === "document" ? DOCUMENT_WORK : PRESENTATION_WORK
  const chromeStrings = kind === "document" ? DOCUMENT_CHROME : PRESENTATION_CHROME
  const kindMarker = kind === "document" ? "printing-document" : "printing-presentation"
  const expectedSize = kind === "document" ? { width: 595.28, height: 841.89 } : { width: 960, height: 540 }

  test(`desktop ${kind} PDF without render-time markers dumps editor chrome (pre-fix state)`, async ({ page }) => {
    await mountDesktopShellAndPaginate(page, {
      kind,
      source,
      markers: [],
      editorMode: kind === "document" ? "source" : "visual",
      preparePrint: false,
    })
    const { text } = await pdfTextAndBoxes(page)
    const flat = text.replace(/\s+/g, " ")
    expect(flat).toContain(workStrings[0])
    const leaked = chromeStrings.filter((chrome) => flat.includes(chrome))
    expect(
      leaked,
      "expected the unmarked projection to leak editor/shell chrome into the PDF (sensitivity control), got work-only text",
    ).not.toHaveLength(0)
  })

  for (const editorMode of kind === "document" ? ["source", "visual"] : ["visual"]) {
    test(`desktop ${kind} (${editorMode} mode) PDF with render-time markers carries the Work only at web geometry`, async ({ page }) => {
      await mountDesktopShellAndPaginate(page, {
        kind,
        source,
        markers: ["printing-work", kindMarker],
        editorMode,
      })
      const marked = await pdfTextAndBoxes(page)
      const markedFlat = marked.text.replace(/\s+/g, " ")
      for (const work of workStrings) expect(markedFlat).toContain(work)
      for (const chrome of chromeStrings) expect(markedFlat).not.toContain(chrome)

      await mountWebPrintAndPaginate(page, { kind, source })
      const web = await pdfTextAndBoxes(page)
      const webFlat = web.text.replace(/\s+/g, " ")
      for (const work of workStrings) expect(webFlat).toContain(work)

      expect(marked.pagesCount).toBe(web.pagesCount)
      expect(marked.pages.map(pageBytes)).toEqual(web.pages.map(pageBytes))
      expect(marked.boxes).toHaveLength(web.boxes.length)
      for (const [index, box] of marked.boxes.entries()) {
        expect(box.width).toBeCloseTo(expectedSize.width, 0)
        expect(box.height).toBeCloseTo(expectedSize.height, 0)
        expect(box.width).toBeCloseTo(web.boxes[index].width, 0)
        expect(box.height).toBeCloseTo(web.boxes[index].height, 0)
      }
    })

    test(`desktop (${editorMode} mode) and web ${kind} print compositions rasterize real content`, async ({ page }) => {
      await mountDesktopShellAndPaginate(page, {
        kind,
        source,
        markers: ["printing-work", kindMarker],
        editorMode,
      })
      const frameSelector = kind === "document" ? "#desktop-preview .document-page-frame" : "#desktop-preview .slide-frame"
      for (const [index, ink] of (await printRasterInk(page, frameSelector)).entries()) {
        expectRealInk(ink, `desktop ${kind} (${editorMode}) page ${index + 1}`)
      }

      await mountWebPrintAndPaginate(page, { kind, source })
      const webFrameSelector = kind === "document" ? ".document-print .document-page-frame" : ".presentation-print .slide-frame"
      for (const [index, ink] of (await printRasterInk(page, webFrameSelector)).entries()) {
        expectRealInk(ink, `web ${kind} page ${index + 1}`)
      }
    })
  }
}

for (const editorMode of ["source", "visual"]) {
  test(`multi-page desktop document (${editorMode} mode) exports every A4 page matching web pagination and print-media geometry`, async ({ page }) => {
    await mountDesktopShellAndPaginate(page, {
      kind: "document",
      source: MULTI_PAGE_DOCUMENT_SOURCE,
      markers: ["printing-work", "printing-document"],
      editorMode,
    })

    // Simulate an mid-transition source-mode snapshot or quiet frame marker to
    // prove CSS alone overrides inline opacity: 0, scroll snapshots, and
    // content-visibility containment under @media print.
    await page.evaluate(() => {
      const surface = document.querySelector("#desktop-preview [data-document-pages-target='surface']")
      surface.style.opacity = "0"
      const snap = document.createElement("div")
      snap.setAttribute("data-preview-scroll-snapshot", "")
      snap.textContent = "ScrollSnapshotLeakToken"
      surface.parentElement.appendChild(snap)
      document.querySelectorAll("#desktop-preview .document-page-frame").forEach((frame) => {
        frame.classList.add("is-quiet")
      })
    })

    await page.emulateMedia({ media: "print" })
    const printLayout = await page.evaluate(() => {
      const reader = document.querySelector("#desktop-preview .document-reader")
      const frames = [...document.querySelectorAll("#desktop-preview .document-page-frame")]
      return {
        bodyDisplay: getComputedStyle(document.body).display,
        sourcePaneDisplay: getComputedStyle(document.querySelector(".source-pane")).display,
        workActionsDisplay: getComputedStyle(document.querySelector(".work-actions")).display,
        layoutDisplay: getComputedStyle(document.querySelector(".editor-layout")).display,
        readerContainerType: getComputedStyle(reader).containerType,
        snapshotDisplay: getComputedStyle(document.querySelector("[data-preview-scroll-snapshot]")).display,
        surfaceOpacity: getComputedStyle(document.querySelector("#desktop-preview .document-surface")).opacity,
        frames: frames.map((frame) => {
          const fr = frame.getBoundingClientRect()
          const fcs = getComputedStyle(frame)
          const card = frame.querySelector(".document-page")
          const cr = card.getBoundingClientRect()
          const ccs = getComputedStyle(card)
          return {
            frameWidth: fr.width,
            frameHeight: fr.height,
            frameTop: fr.top,
            contentVisibility: fcs.contentVisibility,
            containIntrinsicSize: fcs.containIntrinsicSize,
            pagePosition: ccs.position,
            pageTransform: ccs.transform,
            pageWidth: cr.width,
            pageHeight: cr.height,
            pageTop: cr.top,
          }
        }),
      }
    })
    await page.emulateMedia({ media: null })

    expect(printLayout.bodyDisplay).toBe("block")
    expect(printLayout.sourcePaneDisplay).toBe("none")
    expect(printLayout.workActionsDisplay).toBe("none")
    expect(printLayout.layoutDisplay).toBe("block")
    expect(printLayout.readerContainerType).toBe("normal")
    expect(printLayout.snapshotDisplay).toBe("none")
    expect(printLayout.surfaceOpacity).toBe("1")
    expect(printLayout.frames.length).toBeGreaterThanOrEqual(3)

    // 210mm x 297mm at 96dpi is ~793.7px x 1122.5px.
    for (const [index, frame] of printLayout.frames.entries()) {
      expect(frame.pagePosition).toBe("static")
      expect(frame.pageTransform).toBe("none")
      expect(frame.contentVisibility).toBe("visible")
      expect(frame.containIntrinsicSize).toBe("none")
      expect(frame.frameWidth).toBeGreaterThan(790)
      expect(frame.frameWidth).toBeLessThan(798)
      expect(frame.frameHeight).toBeGreaterThan(1118)
      expect(frame.frameHeight).toBeLessThan(1128)
      expect(frame.pageWidth).toBeGreaterThan(790)
      expect(frame.pageHeight).toBeGreaterThan(1118)
      if (index > 0) {
        expect(frame.frameTop).toBeGreaterThan(printLayout.frames[index - 1].frameTop + 1100)
      }
    }

    const desktopPdf = await pdfTextAndBoxes(page)
    expect(desktopPdf.text).not.toContain("ScrollSnapshotLeakToken")
    for (const chrome of DOCUMENT_CHROME) expect(desktopPdf.text).not.toContain(chrome)

    const pageBandsInk = await printRasterInk(page, "#desktop-preview .document-page-frame")
    expect(pageBandsInk).toHaveLength(desktopPdf.pagesCount)
    for (const [index, ink] of pageBandsInk.entries()) {
      expectRealInk(ink, `multi-page desktop (${editorMode}) page ${index + 1}`)
    }

    await mountWebPrintAndPaginate(page, { kind: "document", source: MULTI_PAGE_DOCUMENT_SOURCE })
    const webPdf = await pdfTextAndBoxes(page)
    expect(webPdf.pagesCount).toBeGreaterThanOrEqual(3)
    expect(desktopPdf.pagesCount).toBe(webPdf.pagesCount)
    expect(desktopPdf.pages.map(pageBytes)).toEqual(webPdf.pages.map(pageBytes))
    expect(desktopPdf.boxes).toHaveLength(webPdf.boxes.length)
    for (const [index, box] of desktopPdf.boxes.entries()) {
      expect(box.width).toBeCloseTo(595.28, 0)
      expect(box.height).toBeCloseTo(841.89, 0)
      expect(box.width).toBeCloseTo(webPdf.boxes[index].width, 0)
      expect(box.height).toBeCloseTo(webPdf.boxes[index].height, 0)
    }
  })
}

test("desktop document print flushes visual focusout microtasks without mid-print DOM teardown", async ({ page }) => {
  await mountDesktopShellAndPaginate(page, {
    kind: "document",
    source: MULTI_PAGE_DOCUMENT_SOURCE,
    markers: [],
    editorMode: "visual",
    preparePrint: false,
  })

  const state = await page.evaluate(async (runtimeSource) => {
    const runtime = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(runtimeSource)}`)
    const form = document.querySelector("#desktop-editor-form")
    const preview = document.querySelector("#desktop-preview")
    form.setAttribute("data-controller", "preview")
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    if (form.previewController) form.previewController.projectionFresh = true

    const block = preview.querySelector("[contenteditable='true']")
      || preview.querySelector(".document-editor-block")
      || preview.querySelector("[data-document-pages-target='surface'] > *")
    block?.setAttribute("contenteditable", "true")
    block?.focus()
    const hadActiveEditableBeforeFlush = Boolean(document.activeElement?.closest?.("[contenteditable='true']"))

    const reader = preview.querySelector('[data-controller~="document-pages"]')
    const pagesController = reader?.documentPagesController
    pagesController?.schedulePagination?.()

    const ready = await runtime.flushDesktopPreviewForPrint(preview, form.previewController)
    const hasActiveEditableAfterFlush = Boolean(document.activeElement?.closest?.("[contenteditable='true']"))
    const freshReader = preview.querySelector('[data-controller~="document-pages"]')
    const freshSurface = preview.querySelector('[data-document-pages-target="surface"]')
    freshReader?.documentPagesController?.freezeForPrint?.()
    runtime.syncPrintPageSizeStyle("document")
    document.body.classList.remove(...runtime.ALL_PRINT_MARKERS)
    document.body.classList.add(...runtime.printMarkerClasses("document"))
    void document.body.offsetHeight

    return {
      hadPreviewController: Boolean(form.previewController),
      hadActiveEditableBeforeFlush,
      hasActiveEditableAfterFlush,
      ready,
      settledAfterFlush: freshSurface?.dataset.documentPagesSettled ?? null,
      quietCount: preview.querySelectorAll(".document-page-frame.is-quiet, .document-page-frame.is-sealed").length,
      frameCount: preview.querySelectorAll(".document-page-frame").length,
    }
  }, RUNTIME_BUNDLE)

  expect(state.hadPreviewController).toBe(true)
  expect(state.hadActiveEditableBeforeFlush).toBe(true)
  expect(state.hasActiveEditableAfterFlush).toBe(false)
  expect(state.ready).toBe(true)
  expect(state.settledAfterFlush).toBe("true")
  expect(state.quietCount).toBe(0)
  expect(state.frameCount).toBeGreaterThanOrEqual(2)

  // Wait past DocumentPagesController's 300ms reflow debounce to prove no stale
  // focusout microtask/timer rebuilds or re-quiets the pages during print.
  await page.waitForTimeout(400)

  const postWait = await page.evaluate(() => ({
    settled: document.querySelector('#desktop-preview [data-document-pages-target="surface"]')?.dataset.documentPagesSettled ?? null,
    quietCount: document.querySelectorAll("#desktop-preview .document-page-frame.is-quiet, #desktop-preview .document-page-frame.is-sealed").length,
  }))
  expect(postWait).toEqual({ settled: "true", quietCount: 0 })

  const pdf = await pdfTextAndBoxes(page)
  expect(pdf.pagesCount).toBe(state.frameCount)
  for (const [index, text] of pdf.pages.entries()) {
    expect(pageBytes(text)).not.toBe("")
    expect(pdf.boxes[index].width).toBeCloseTo(595.28, 0)
    expect(pdf.boxes[index].height).toBeCloseTo(841.89, 0)
  }
  const pageBandsInk = await printRasterInk(page, "#desktop-preview .document-page-frame")
  expect(pageBandsInk).toHaveLength(state.frameCount)
  for (const [index, ink] of pageBandsInk.entries()) {
    expectRealInk(ink, `desktop visual-flush page ${index + 1}`)
  }
})

test("desktop document print aborts in-flight preview fetches, clears source opacity, and unlocks after input", async ({ page }) => {
  await mountDesktopShellAndPaginate(page, {
    kind: "document",
    source: "# Initial Draft\n\nStale body before edit.",
    markers: [],
    editorMode: "source",
    preparePrint: false,
  })
  const updatedHtml = renderPreview({
    kind: "document",
    source: MULTI_PAGE_DOCUMENT_SOURCE,
    style: styleOf(),
    title: "Probe work",
    allowRemoteMedia: false,
  }).html

  const result = await page.evaluate(async ({ runtimeSource, nextSource, nextHtml }) => {
    const runtime = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(runtimeSource)}`)
    const form = document.querySelector("#desktop-editor-form")
    const preview = document.querySelector("#desktop-preview")

    let abortedFirstRequest = false
    let requestCount = 0
    window.fetch = (_url, init) => {
      requestCount += 1
      if (requestCount === 1) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            abortedFirstRequest = true
            reject(new DOMException("Aborted", "AbortError"))
          })
        })
      }
      return Promise.resolve(new Response(JSON.stringify({ html: nextHtml, warnings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
    }

    form.setAttribute("data-preview-url-value", "/mock-desktop-preview")
    form.setAttribute("data-controller", "preview")
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const previewController = form.previewController

    const textarea = form.querySelector(".source-field textarea")
    if (textarea) {
      textarea.name = textarea.name || "document[source]"
      textarea.value = nextSource
    }
    void previewController.refresh(++previewController.requestId)
    const hadInFlightBeforeFlush = Boolean(previewController.requestController)

    const ready = await runtime.flushDesktopPreviewForPrint(preview, previewController)
    const reader = preview.querySelector('[data-controller~="document-pages"]')
    const pagesController = reader?.documentPagesController
    const surface = preview.querySelector('[data-document-pages-target="surface"]')
    pagesController?.freezeForPrint?.()
    runtime.syncPrintPageSizeStyle("document")
    document.body.classList.remove(...runtime.ALL_PRINT_MARKERS)
    document.body.classList.add(...runtime.printMarkerClasses("document"))
    void document.body.offsetHeight

    // While frozen, background schedulePagination() must not flip settled back to "false".
    pagesController?.schedulePagination?.()
    const settledWhileFrozen = surface?.dataset.documentPagesSettled ?? null

    return {
      hadPreviewController: Boolean(previewController),
      hadInFlightBeforeFlush,
      abortedFirstRequest,
      requestCount,
      ready,
      surfaceOpacity: surface?.style.opacity ?? "",
      scrollSnapshots: preview.querySelectorAll("[data-preview-scroll-snapshot]").length,
      settled: surface?.dataset.documentPagesSettled ?? null,
      settledWhileFrozen,
      quietCount: preview.querySelectorAll(".document-page-frame.is-quiet, .document-page-frame.is-sealed").length,
      frameCount: preview.querySelectorAll(".document-page-frame").length,
    }
  }, { runtimeSource: RUNTIME_BUNDLE, nextSource: MULTI_PAGE_DOCUMENT_SOURCE, nextHtml: updatedHtml })

  expect(result.hadPreviewController).toBe(true)
  expect(result.hadInFlightBeforeFlush).toBe(true)
  expect(result.abortedFirstRequest).toBe(true)
  expect(result.requestCount).toBe(2)
  expect(result.ready).toBe(true)
  expect(result.surfaceOpacity).toBe("")
  expect(result.scrollSnapshots).toBe(0)
  expect(result.settled).toBe("true")
  expect(result.settledWhileFrozen).toBe("true")
  expect(result.quietCount).toBe(0)
  expect(result.frameCount).toBeGreaterThanOrEqual(2)

  await page.waitForTimeout(400)

  const pdf = await pdfTextAndBoxes(page)
  expect(pdf.pagesCount).toBe(result.frameCount)
  expect(pageBytes(pdf.pages.join(""))).toContain(pageBytes("Multi-Page Section 18"))
  for (const [index, text] of pdf.pages.entries()) {
    expect(pageBytes(text)).not.toBe("")
    expect(pdf.boxes[index].width).toBeCloseTo(595.28, 0)
    expect(pdf.boxes[index].height).toBeCloseTo(841.89, 0)
  }

  // Simulate user editing after print sheet closes: pagination must unlock and resume.
  const resumed = await page.evaluate(() => {
    window.dispatchEvent(new Event("input", { bubbles: true }))
    const reader = document.querySelector('#desktop-preview [data-controller~="document-pages"]')
    const pagesController = reader?.documentPagesController
    pagesController?.schedulePagination?.()
    return {
      frozenAfterInput: pagesController?.frozenForPrint ?? null,
      settledOnReschedule: reader?.querySelector('[data-document-pages-target="surface"]')?.dataset.documentPagesSettled ?? null,
    }
  })
  expect(resumed).toEqual({ frozenAfterInput: false, settledOnReschedule: "false" })
})

test("flushDesktopPreviewForPrint fails closed on refresh errors, clears fresh scroll snapshots, and unfreeze resizes frames", async ({ page }) => {
  await mountDesktopShellAndPaginate(page, {
    kind: "document",
    source: MULTI_PAGE_DOCUMENT_SOURCE,
    markers: [],
    editorMode: "source",
    preparePrint: false,
  })

  const check = await page.evaluate(async (runtimeSource) => {
    const runtime = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(runtimeSource)}`)
    const form = document.querySelector("#desktop-editor-form")
    const preview = document.querySelector("#desktop-preview")
    form.setAttribute("data-preview-url-value", "/mock-desktop-preview")
    form.setAttribute("data-controller", "preview")
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const previewController = form.previewController

    // Simulate a pending source-mode scroll snapshot while projectionFresh === true.
    let snapshotCanceled = false
    const surface = preview.querySelector('[data-document-pages-target="surface"]')
    surface.style.opacity = "0"
    surface.setAttribute("inert", "")
    const fakeSnapshot = document.createElement("div")
    fakeSnapshot.setAttribute("data-preview-scroll-snapshot", "")
    preview.querySelector(".document-editor-projection")?.append(fakeSnapshot)
    previewController.projectionFresh = true
    previewController.cancelPendingPreviewScroll = () => {
      snapshotCanceled = true
      fakeSnapshot.remove()
      surface.style.opacity = ""
      surface.removeAttribute("inert")
      previewController.cancelPendingPreviewScroll = null
    }

    const freshOk = await runtime.flushDesktopPreviewForPrint(preview, previewController)
    const snapshotsRemaining = preview.querySelectorAll("[data-preview-scroll-snapshot]").length
    const opacityAfterFlush = surface.style.opacity

    // Freeze, unfreeze, and confirm resizeFrames runs on unfreeze.
    const reader = preview.querySelector('[data-controller~="document-pages"]')
    const pagesController = reader?.documentPagesController
    let resizeCalls = 0
    const origResizeFrames = pagesController.resizeFrames.bind(pagesController)
    pagesController.resizeFrames = () => {
      resizeCalls += 1
      return origResizeFrames()
    }
    pagesController.freezeForPrint()
    pagesController.unfreezeForPrint()

    // Simulate stale DOM present while flushForPrint fails refresh or returns undefined (superseded/mid-edit).
    previewController.projectionFresh = false
    previewController.refresh = async () => false
    const failedReady = await runtime.flushDesktopPreviewForPrint(preview, previewController)
    previewController.refresh = async () => undefined
    const undefinedReady = await runtime.flushDesktopPreviewForPrint(preview, previewController)

    return {
      freshOk,
      snapshotCanceled,
      snapshotsRemaining,
      opacityAfterFlush,
      resizeCalls,
      failedReady,
      undefinedReady,
      hadStaleDom: preview.childElementCount > 0,
    }
  }, RUNTIME_BUNDLE)

  expect(check).toEqual({
    freshOk: true,
    snapshotCanceled: true,
    snapshotsRemaining: 0,
    opacityAfterFlush: "",
    resizeCalls: 1,
    failedReady: false,
    undefinedReady: false,
    hadStaleDom: true,
  })
})

test("presentation print CSS preserves all slides and unrevealed blocks even with presenting-work classes", async ({ page }) => {
  await mountDesktopShellAndPaginate(page, {
    kind: "presentation",
    source: PRESENTATION_SOURCE,
    markers: ["printing-work", "printing-presentation"],
    editorMode: "visual",
  })

  const state = await page.evaluate(async (runtimeSource) => {
    const runtime = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(runtimeSource)}`)
    const preview = document.querySelector("#desktop-preview")
    const frames = [...preview.querySelectorAll(".slide-frame")]
    const presentation = runtime.mountPresentation(preview)
    const started = presentation.controller.start()
    const slide1Active = frames[0]?.classList.contains("is-active-presentation-slide") ?? false
    const slide2HiddenWhilePresenting = frames[1]?.hidden ?? false
    presentation.destroy()
    const slide2HiddenAfterDestroy = frames[1]?.hidden ?? false

    // Also keep stale presenting-work and reveal-hidden classes during @media print
    // to prove @media screen scoping isolates print layout from presentation chrome.
    document.body.classList.add("presenting-work")
    frames[0]?.classList.add("is-active-presentation-slide")
    frames[0]?.querySelectorAll(".slide-block").forEach((block) => block.classList.add("is-presentation-reveal-hidden"))
    return {
      frameCount: frames.length,
      started,
      slide1Active,
      slide2HiddenWhilePresenting,
      slide2HiddenAfterDestroy,
    }
  }, RUNTIME_BUNDLE)

  expect(state).toEqual({
    frameCount: 2,
    started: true,
    slide1Active: true,
    slide2HiddenWhilePresenting: true,
    slide2HiddenAfterDestroy: false,
  })

  const pdf = await pdfTextAndBoxes(page)
  expect(pdf.pagesCount).toBe(2)
  expect(pageBytes(pdf.pages[0])).toContain(pageBytes("SeedTitle"))
  expect(pageBytes(pdf.pages[0])).toContain(pageBytes("fencedseparatorstaysliteral"))
  expect(pageBytes(pdf.pages[0])).toContain("1/2")
  expect(pageBytes(pdf.pages[1])).toContain(pageBytes("SecondSlide"))
  expect(pageBytes(pdf.pages[1])).toContain("2/2")
  for (const box of pdf.boxes) {
    expect(box.width).toBeCloseTo(960, 0)
    expect(box.height).toBeCloseTo(540, 0)
  }
})
