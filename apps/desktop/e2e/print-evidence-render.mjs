// Print-evidence renderer (dispatch-only): prints each captured render-time
// DOM to PDF bytes with headless Chromium (real print pipeline,
// `preferCSSPageSize`, print backgrounds) and renders the ACTUAL PDF pages
// to PNG images. Observational only: it records what the flow produced and
// asserts nothing about markers or content, so it runs identically on
// pre-fix and fixed code.
//
// The captured HTML keeps its `./assets/...` stylesheet links; a `<base>`
// element points them at the shipped frontend bundle (dist-e2e) the real
// app served, so the PDF uses the exact stylesheets the app used.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { chromium } from "@playwright/test"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"

function argument(name) {
  const value = process.argv[process.argv.indexOf(name) + 1]
  if (!value) throw new Error(`print-evidence-render.mjs requires ${name} <path>`)
  return path.resolve(value)
}

const capturesDir = argument("--captures")
const distDir = argument("--dist")
const outDir = argument("--out")

const SLUGS = ["presentation", "document"]

function insertBase(html, baseUrl) {
  if (!/<head[^>]*>/i.test(html)) throw new Error("Captured DOM has no <head> element for the stylesheet base")
  // The capture carries the live app's <script> tags. They must not execute
  // in the render context: booting a second app instance would mutate the
  // captured DOM (re-render the preview, touch the markers) and corrupt the
  // evidence. Stylesheets stay; scripts go.
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
  return stripped.replace(/<head[^>]*>/i, match => `${match}<base href="${baseUrl}">`)
}

async function pdfTextAndBoxes(bytes) {
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
  let text = ""
  for (let number = 1; number <= document.numPages; number += 1) {
    const content = await (await document.getPage(number)).getTextContent()
    text += `${content.items.map(item => item.str ?? "").join(" ")}\n`
  }
  const raw = Buffer.from(bytes).toString("latin1")
  const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(match => ({
    width: Number(match[3]) - Number(match[1]),
    height: Number(match[4]) - Number(match[2]),
  }))
  return { text, boxes, pages: document.numPages }
}

await mkdir(outDir, { recursive: true })
const scratchDir = path.join(distDir, "print-evidence-scratch")
await mkdir(scratchDir, { recursive: true })

const browser = await chromium.launch()
try {
  const manifest = { tool: "print-evidence-render.mjs", fixtures: {} }
  for (const slug of SLUGS) {
    const captureHtml = await readFile(path.join(capturesDir, `${slug}.html`), "utf8")
    const captureMeta = JSON.parse(await readFile(path.join(capturesDir, `${slug}.json`), "utf8"))
    const basedHtml = insertBase(captureHtml, `${pathToFileURL(`${distDir}/`).href}`)
    const scratchFile = path.join(scratchDir, `${slug}.html`)
    await writeFile(scratchFile, basedHtml, "utf8")
    const page = await browser.newPage()
    await page.goto(pathToFileURL(scratchFile).href, { waitUntil: "networkidle" })
    await page.evaluate(() => document.fonts.ready)
    const pdfBytes = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    await page.close()
    if (!pdfBytes.length) throw new Error(`Chromium produced an empty PDF for ${slug}`)
    const pdfFile = path.join(outDir, `${slug}.pdf`)
    await writeFile(pdfFile, pdfBytes)
    const { text, boxes, pages } = await pdfTextAndBoxes(pdfBytes)
    if (pages < 1) throw new Error(`Chromium produced a page-less PDF for ${slug}`)
    const prefix = path.join(outDir, `${slug}-page`)
    try {
      execFileSync("pdftoppm", ["-png", "-r", "110", pdfFile, prefix], { stdio: "inherit" })
    } catch (error) {
      throw new Error(`pdftoppm could not render ${slug}.pdf pages (poppler-utils required): ${error.message}`)
    }
    const pageImages = (await readdir(outDir))
      .filter(name => name.startsWith(`${slug}-page`) && name.endsWith(".png"))
      .sort()
    if (pageImages.length !== pages) {
      throw new Error(`Expected ${pages} page image(s) for ${slug}, found ${pageImages.length}`)
    }
    manifest.fixtures[slug] = {
      ...captureMeta,
      pdfFile: `${slug}.pdf`,
      pdfBytes: pdfBytes.length,
      pdfSha256: createHash("sha256").update(pdfBytes).digest("hex"),
      pages,
      pageSizesPt: boxes,
      pageImages,
      pdfText: text,
    }
    console.log(`${slug}: ${pages} page(s), sizes ${boxes.map(box => `${box.width.toFixed(2)}x${box.height.toFixed(2)}pt`).join(", ")}`)
  }
  await writeFile(path.join(outDir, "evidence-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8")
  console.log(`Print-evidence artifacts written to ${outDir}`)
} finally {
  await browser.close()
}
