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
// Two render-time states, one Work each:
// - markers OFF: the pre-fix render-time state. Clearing the print markers
//   when the native command resolves (before the platform dialog renders)
//   prints the unmarked live editor shell: this state MUST show chrome, and
//   that assertion is the probe's sensitivity control — it proves the probe
//   can see the owner's reported UI-chrome dump.
// - markers ON: the fixed render-time state (markers persist across the
//   native dialog lifetime). This state must be work-only at web geometry.
import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import { renderPreviewCore } from "@elef/renderer"
import { renderPreview } from "./shared_helpers.js"

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const PRESENTATION_SOURCE = [
  "# Seed Title",
  "",
  "Hello from the seed work.",
  "",
  `![Seed alt text](${PIXEL_PNG})`,
  "",
  "---",
  "",
].join("\n")

const DOCUMENT_SOURCE = [
  "# Document Title",
  "",
  "Flowing document paragraph one.",
  "",
  `![Doc alt text](${PIXEL_PNG})`,
  "",
].join("\n")

const PRESENTATION_WORK = ["Seed Title", "Hello from the seed work."]
const DOCUMENT_WORK = ["Document Title", "Flowing document paragraph one."]
// Editor chrome the fixed state must keep out of the PDF. "Empty slide" is
// deliberately absent: both hosts print the empty-slide paragraph (the web
// print partial renders it unconditionally), so it is parity, not chrome.
const PRESENTATION_CHROME = ["Add slide", "Slide 1", "Add block", "Move down", "Align", "Add image", "Seed alt text"]
const DOCUMENT_CHROME = ["Align", "Doc alt text"]

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
  return `<!doctype html><html><head><meta charset="utf-8"><style>${"/*STYLES*/"}</style></head><body class="${classes}"><div id="desktop-preview">${previewHtml}</div></body></html>`
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
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
  let text = ""
  for (let number = 1; number <= document.numPages; number += 1) {
    const content = await (await document.getPage(number)).getTextContent()
    text += `${content.items.map((item) => item.str ?? "").join(" ")}\n`
  }
  const raw = Buffer.from(bytes).toString("latin1")
  const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(
    (match) => ({ width: Number(match[3]) - Number(match[1]), height: Number(match[4]) - Number(match[2]) }),
  )
  return { text, boxes, pages: document.numPages }
}

async function setPage(page, html, styles) {
  await page.setContent(html.replace("/*STYLES*/", () => styles))
}

async function renderDesktopPdf(page, { kind, source, markers, styles }) {
  const previewHtml = renderPreview({ kind, source, style: styleOf(), title: "Probe work", allowRemoteMedia: false }).html
  await setPage(page, desktopPage({ previewHtml, markers }), styles)
  return pdfTextAndBoxes(page)
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
    for (const work of workStrings) expect(text).toContain(work)
    const leaked = chromeStrings.filter((chrome) => text.includes(chrome))
    expect(
      leaked,
      `expected the unmarked projection to leak editor chrome into the PDF (sensitivity control), got work-only text`,
    ).not.toHaveLength(0)
  })

  test(`desktop ${kind} PDF with render-time markers carries the Work only at web geometry`, async ({ page }) => {
    const styles = await desktopStyles()
    const marked = await renderDesktopPdf(page, { kind, source, markers: ["printing-work", kindMarker], styles })
    for (const work of workStrings) expect(marked.text).toContain(work)
    for (const chrome of chromeStrings) expect(marked.text).not.toContain(chrome)

    const bareHtml = renderPreviewCore({ kind, source, style: styleOf(), title: "Probe work", allowRemoteMedia: false }).html
    await setPage(page, webPage({ bareHtml, kind }), await webStyles())
    const web = await pdfTextAndBoxes(page)
    for (const work of workStrings) expect(web.text).toContain(work)

    expect(marked.pages).toBe(web.pages)
    expect(marked.boxes).toHaveLength(web.boxes.length)
    for (const [index, box] of marked.boxes.entries()) {
      expect(box.width).toBeCloseTo(expectedSize.width, 0)
      expect(box.height).toBeCloseTo(expectedSize.height, 0)
      expect(box.width).toBeCloseTo(web.boxes[index].width, 0)
      expect(box.height).toBeCloseTo(web.boxes[index].height, 0)
    }
  })
}
