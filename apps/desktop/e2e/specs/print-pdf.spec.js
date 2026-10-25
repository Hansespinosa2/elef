// Desktop PDF content probe: the exported PDF must carry the Work only,
// never app or editor chrome, at the web page size.
//
// The desktop prints its live editor projection (renderPreviewCore composed
// with the real editorChrome, styled by the real file_library_host.css —
// the same stylesheet build.mjs copies into the shipped app), while the web
// prints a dedicated work-only route. Both states below render through
// Chromium's real print pipeline (page.pdf) and assert on extracted PDF
// text plus page boxes, the way the Rails print system tests assert
// Page.printToPDF bytes.
//
// The seed is a small comprehensive Work pair both hosts render: headings,
// formatted text, a code fence containing a slide separator (which must stay
// literal), a table, inline math, and a captioned image, plus a second slide
// (two-column regions for presentations) so pagination is covered. The same
// markdown renders on both hosts through the shared renderer; the probe
// byte-compares what each host's print composition puts into PDF pages.
//
// Three render-time states, one Work each:
// - markers OFF: the pre-fix render-time state. Clearing the print markers
//   when the native command resolves (before the platform dialog renders)
//   prints the unmarked live editor shell: this state MUST show chrome, and
//   that assertion is the probe's sensitivity control — it proves the probe
//   can see the owner's reported UI-chrome dump.
// - markers ON: the fixed render-time state (markers persist across the
//   native dialog lifetime). This state must be work-only at web geometry,
//   with page text byte-equal to the web PDF.
// - rasters: the print-media composition Chromium feeds to page.pdf is
//   rasterized to PNG and decoded in-test (no screenshot tooling, no stored
//   golden files to hallucinate against). Every composition must carry real
//   ink: a content-free page fails here even if its PDF bytes parse.
import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { inflateSync } from "node:zlib"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import { renderPreviewCore } from "@elef/renderer"
import { renderPreview } from "./shared_helpers.js"

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

// Small comprehensive seed pair, renderable in both hosts through the shared
// renderer. Both seeds extend the original probe (titles and caption alt
// texts stay byte-identical) so the caption regression stays pinned while
// headings, fences, tables, math, and multi-slide pagination are covered.
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
// Editor chrome the fixed state must keep out of the PDF. Image alt text is
// deliberately absent from both lists: the caption figcaption carries the
// author's image description, the web print partial renders it
// unconditionally, and the desktop print keeps it too — captions are Work
// content, not chrome, so they are asserted present above.
const PRESENTATION_CHROME = ["Add slide", "Slide 1", "Add block", "Move down", "Align", "Add image"]
const DOCUMENT_CHROME = ["Align"]

async function desktopStyles() {
  // The operative print sheet plus the base both hosts share. build.mjs
  // copies file_library_host.css into the shipped app byte-identical, so
  // reading the source keeps the probe drift-free with no frontend build.
  const host = await readFile(new URL("../../../web/app/assets/stylesheets/file_library_host.css", import.meta.url), "utf8")
  const tailwind = await readFile(new URL("../../../web/app/assets/builds/tailwind.css", import.meta.url), "utf8")
  return `${tailwind}\n${host}`
}

async function webStyles() {
  const print = await readFile(
    new URL("../../../web/app/assets/stylesheets/components/documents.css", import.meta.url),
    "utf8",
  )
  const tailwind = await readFile(new URL("../../../web/app/assets/builds/tailwind.css", import.meta.url), "utf8")
  return `${tailwind}\n${print}`
}

function styleOf() {
  return { theme: "light", typography: "book" }
}

function desktopPage({ previewHtml, markers }) {
  const classes = ["elef-app", ...markers].join(" ")
  return `<!doctype html><html><head><meta charset="utf-8"><style>/*STYLES*/</style></head><body class="${classes}"><div id="desktop-preview">${previewHtml}</div></body></html>`
}

function webPage({ bareHtml, kind }) {
  const toolbar = `<div class="${kind === "document" ? "presentation-print-toolbar document-print-toolbar" : "presentation-print-toolbar"}"><button type="button">Save as PDF</button></div>`
  const main =
    kind === "document"
      ? `<main class="document-print">${toolbar}<div class="document-print-pages"><div class="document-page-frame"><div class="document-page"><div class="document-page-content">${bareHtml}</div></div></div></div></main>`
      : `<main class="presentation-print presentation-surface">${toolbar}<div class="slides presentation-print-slides">${bareHtml}</div></main>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>/*STYLES*/</style></head><body>${main}</body></html>`
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

async function setPage(page, html, styles) {
  await page.setContent(html.replace("/*STYLES*/", () => styles))
}

async function renderDesktopPdf(page, { kind, source, markers, styles }) {
  const previewHtml = renderPreview({ kind, source, style: styleOf(), title: "Probe work", allowRemoteMedia: false }).html
  await setPage(page, desktopPage({ previewHtml, markers }), styles)
  return pdfTextAndBoxes(page)
}

// Minimal PNG decoder (8-bit non-interlaced RGB/RGBA, all filter types):
// Playwright screenshots need no image tooling and no golden files. Counts
// ink pixels so a content-free page fails numerically instead of by eyeball.
function pngInk(buffer) {
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
  let nonWhite = 0
  let dark = 0
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
    for (let x = 0; x < width; x += 1) {
      const r = recon[x * channels]
      const g = recon[x * channels + 1]
      const b = recon[x * channels + 2]
      if (r < 250 || g < 250 || b < 250) nonWhite += 1
      if (r < 128 && g < 128 && b < 128) dark += 1
    }
  }
  return { width, height, nonWhite, dark, nonWhiteFraction: nonWhite / (width * height) }
}

// Rasters the exact print-media composition Chromium feeds to page.pdf (the
// print stylesheet applies; screen-only chrome stays hidden). A blank or
// content-free composition fails here even when its PDF bytes parse.
async function printRasterInk(page) {
  await page.emulateMedia({ media: "print" })
  try {
    const shot = await page.screenshot({ fullPage: true })
    return pngInk(shot)
  } finally {
    await page.emulateMedia({ media: null })
  }
}

// Real ink means rendered Work, not a blank page: the seed compositions
// raster to several times these thresholds (the presentation seed measures
// ~0.005 non-white fraction with ~5000 dark text pixels; the document seed
// likewise clears both bars), while an empty composition measures exactly
// zero. A content-free page fails here even when its PDF bytes parse.
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
    const styles = await desktopStyles()
    const { text } = await renderDesktopPdf(page, { kind, source, markers: [], styles })
    const flat = text.replace(/\s+/g, " ")
    for (const work of workStrings) expect(flat).toContain(work)
    const leaked = chromeStrings.filter((chrome) => flat.includes(chrome))
    expect(
      leaked,
      `expected the unmarked projection to leak editor chrome into the PDF (sensitivity control), got work-only text`,
    ).not.toHaveLength(0)
  })

  test(`desktop ${kind} PDF with render-time markers carries the Work only at web geometry`, async ({ page }) => {
    const styles = await desktopStyles()
    const marked = await renderDesktopPdf(page, { kind, source, markers: ["printing-work", kindMarker], styles })
    const markedFlat = marked.text.replace(/\s+/g, " ")
    for (const work of workStrings) expect(markedFlat).toContain(work)
    for (const chrome of chromeStrings) expect(markedFlat).not.toContain(chrome)

    const bareHtml = renderPreviewCore({ kind, source, style: styleOf(), title: "Probe work", allowRemoteMedia: false }).html
    await setPage(page, webPage({ bareHtml, kind }), await webStyles())
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

  test(`desktop and web ${kind} print compositions rasterize real content`, async ({ page }) => {
    const previewHtml = renderPreview({ kind, source: source, style: styleOf(), title: "Probe work", allowRemoteMedia: false }).html
    await setPage(page, desktopPage({ previewHtml, markers: ["printing-work", kindMarker] }), await desktopStyles())
    expectRealInk(await printRasterInk(page), `desktop ${kind}`)

    const bareHtml = renderPreviewCore({ kind, source, style: styleOf(), title: "Probe work", allowRemoteMedia: false }).html
    await setPage(page, webPage({ bareHtml, kind }), await webStyles())
    expectRealInk(await printRasterInk(page), `web ${kind}`)
  })
}
