import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

// Desktop PDF must export the Work, never an app-UI copy, with web-quality
// output: the print stylesheet hides every shell/editor surface and the
// presentation geometry matches the web print views exactly, while the
// editor runtime prepares printing through the shared print contract.
const hostCss = await readFile(
  new URL("../../../web/app/assets/stylesheets/file_library_host.css", import.meta.url),
  "utf8",
)
const webPrintCss = await readFile(
  new URL("../../../web/app/assets/stylesheets/components/documents.css", import.meta.url),
  "utf8",
)
const slidesCss = await readFile(
  new URL("../../../web/app/assets/stylesheets/components/slides.css", import.meta.url),
  "utf8",
)
const printFlow = await readFile(
  new URL("../../../../packages/editor-runtime/src/lib/file_library_application.ts", import.meta.url),
  "utf8",
)

function printBlock(css) {
  const start = css.indexOf("@media print")
  assert.notEqual(start, -1, "expected a print stylesheet")
  return css.slice(start)
}

test("the desktop print stylesheet hides every app-shell and editor-chrome surface", () => {
  const print = printBlock(hostCss)
  for (const selector of [
    ".desktop-app-shell > :not(#work-view)",
    "#export-menu",
    "#export-menu-mount",
    ".work-view > :not(#desktop-editor-form)",
    ".export-menu",
    "#export-pptx-status",
    "#start-presentation",
    "#work-notice",
    ".command-palette",
    ".source-pane",
    ".editor-shell-header",
    ".editor-footer",
    ".presentation-editor-tools",
    ".document-block-position-control",
    "[data-preview-scroll-snapshot]",
    ".empty-slide-add-image",
  ]) {
    assert.ok(print.includes(selector), `expected the print stylesheet to hide ${selector}`)
  }
})

test("the desktop print keeps image captions like the web print views do", () => {
  // The figcaption carries the author's image description: the web print
  // partial renders the same editor-media-caption node unconditionally, so
  // hiding it on desktop drops Work content from the desktop PDF only.
  const print = printBlock(hostCss)
  assert.ok(
    !/\.editor-media-caption[^{]*\{[^}]*display:\s*none/.test(print),
    "expected the print stylesheet to keep media captions printable",
  )
})

test("the desktop presentation print geometry matches the web print views", () => {
  const print = printBlock(hostCss)
  assert.ok(print.includes("width: 13.333in"), "expected the web 13.333in slide width")
  assert.ok(print.includes("height: 7.5in"), "expected the web 7.5in slide height")
  assert.ok(print.includes("padding: 5rem"), "expected the web 5rem slide padding")
  for (const rule of [
    "width: 13.333in",
    "height: 7.5in",
    "padding: 5rem",
    "video::-webkit-media-controls",
    "is-overflowing",
  ]) {
    assert.ok(webPrintCss.includes(rule), `expected the web print views to define ${rule}`)
  }
})

test("the desktop document print path selects A4 without touching the PPTX pipeline", () => {
  const print = printBlock(hostCss)
  assert.ok(print.includes("printing-document"), "expected a document print marker")
  assert.ok(print.includes("printing-presentation"), "expected a presentation print marker")
  assert.ok(print.includes("A4"), "expected A4 document geometry")
  assert.ok(print.includes("@page { size: A4 portrait; margin: 0; }"), "expected zero-margin A4 default @page for WebKit fallback")
  assert.ok(!print.includes("exportPptx"), "the print stylesheet must not invoke the PPTX seam")
})

test("the desktop document print neutralizes the paginated editor projection at web A4 geometry", () => {
  const print = printBlock(hostCss)
  for (const token of [
    ".printing-work.printing-document #desktop-preview .document-reader",
    ".printing-work.printing-document .document-page-frame",
    ".printing-work.printing-document .document-page-frame > .document-page",
    "container-type: normal !important",
    "width: 210mm !important",
    "height: 297mm !important",
    "padding: 16mm !important",
    "content-visibility: visible !important",
    "contain-intrinsic-size: none !important",
    "html:has(> body.printing-work)",
  ]) {
    assert.ok(print.includes(token), `expected the print stylesheet to include ${token}`)
  }
  for (const token of [
    ".editor-projection .document-reader",
    ".document-page-frame > .document-page",
    "contain-intrinsic-size: none",
  ]) {
    assert.ok(webPrintCss.includes(token), `expected components/documents.css @media print to include ${token}`)
  }
})

test("the desktop print flow prepares through the shared print contract", () => {
  for (const token of ["pausePrintVideos", "printMarkerClasses", "printWorkKindForSourceFile", "ALL_PRINT_MARKERS", "syncPrintPageSizeStyle", "elef:document-pages-settled"]) {
    assert.ok(printFlow.includes(token), `expected printCurrentWork to use the shared ${token}`)
  }
  assert.ok(printFlow.includes("elements.workView.hidden"), "expected printCurrentWork to require an open visible work view")
  assert.ok(printFlow.includes('document.body.classList.contains("presenting-work")) await exitPresentation()'), "expected printCurrentWork to exit presentation mode before printing")
  assert.ok(printFlow.includes("kind: printKind"), "expected the harness probe to carry the work kind")
})

test("presentation-mode hiding stays screen-scoped so printing never drops slides or revealed blocks", () => {
  const screenStart = hostCss.indexOf("@media screen")
  const printStart = hostCss.indexOf("@media print")
  assert.notEqual(screenStart, -1, "expected @media screen scoping in file_library_host.css")
  assert.ok(screenStart < printStart, "expected @media screen before @media print")
  const presentingIdx = hostCss.indexOf(".presenting-work .slide-frame")
  assert.ok(presentingIdx > screenStart && presentingIdx < printStart, "expected .presenting-work rules inside @media screen")
  assert.ok(/@media screen\s*\{[^}]*is-presentation-reveal-hidden/s.test(slidesCss), "expected reveal-hidden hiding to be scoped to @media screen")
})

test("the desktop presentation print neutralizes the editor projection so one slide fills one page", () => {
  // The desktop prints the live editor projection (scaled canvas, flex
  // slide internals, positioned blocks, shell padding and borders) while
  // the web prints a dedicated block-layout partial. Without
  // neutralization Chromium drops flex-column projection content when
  // fragmenting it (blank first page, clipped oversized title, missing
  // blocks) and the shell chain offsets the frame past the page fold.
  const print = printBlock(hostCss)
  for (const selector of [
    ".printing-work .slide,",
    ".printing-work .slide-block { display: block",
    ".printing-work #desktop-preview,",
    ".printing-work .slide-frame { margin: 0",
    ".printing-work .slide-frame:last-of-type",
  ]) {
    assert.ok(print.includes(selector), `expected the print stylesheet to neutralize the projection: ${selector}`)
  }
})

test("the print markers stay print-media-only so persisting them is screen-safe", () => {
  // printCurrentWork keeps the markers across the native dialog lifetime
  // (the dialog outlives the command resolve); that is only safe while no
  // screen stylesheet keys off them. The flow must also never clear the
  // markers when the command resolves.
  const screenCss = hostCss.slice(0, hostCss.indexOf("@media print"))
  for (const marker of ["printing-work", "printing-document", "printing-presentation"]) {
    assert.ok(!screenCss.includes(marker), `expected no screen rule to reference ${marker}`)
  }
  assert.ok(
    !/finally\s*{[^}]*classList\.remove/.test(printFlow),
    "expected printCurrentWork to keep the markers once the native command resolves",
  )
})
