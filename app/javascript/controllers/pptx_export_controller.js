import { Controller } from "@hotwired/stimulus"

const PX_PER_INCH = 96
const REMOTE_FONT_FALLBACK = "Arial"
let pptxLibraryPromise

export default class extends Controller {
  static targets = ["status"]
  static values = { url: String, libraryUrl: String, currentDraft: Boolean }

  async download(event) {
    event.preventDefault()
    const button = this.element.querySelector("button")
    button.disabled = true

    try {
      this.setStatus("Preparing PowerPoint…")
      const request = { headers: { Accept: "application/json" }, credentials: "same-origin" }
      if (this.currentDraftValue) {
        const form = document.querySelector('form[data-controller~="autosave"]')
        if (!form) throw new Error("The current draft form is unavailable for export.")

        request.method = "POST"
        request.headers["X-CSRF-Token"] = document.querySelector('meta[name="csrf-token"]')?.content || ""
        request.body = new FormData(form)
        request.body.delete("_method")
      }
      const response = await fetch(this.urlValue, request)
      const model = await response.json()
      if (!response.ok) throw new Error(model.error || "The PowerPoint export could not be prepared.")

      await loadPptxLibrary(this.libraryUrlValue)
      const pptx = createPresentation(model)
      const stage = createRenderStage(model)
      document.body.append(stage)
      let assets
      try {
        assets = await prepareMedia(stage)
        await renderSlides(pptx, stage, model, assets)
      } finally {
        stage.remove()
        assets?.objectUrls.forEach((url) => URL.revokeObjectURL(url))
      }

      const blob = await pptx.write({ outputType: "blob" })
      downloadBlob(blob, model.filename)
      this.setStatus("PowerPoint downloaded.")
    } catch (error) {
      console.error("PPTX export failed", error)
      this.setStatus(error.message || "The PowerPoint export failed.")
    } finally {
      button.disabled = false
    }
  }

  setStatus(message) {
    if (this.hasStatusTarget) this.statusTarget.textContent = message
  }
}

export function loadPptxLibrary(url) {
  if (window.PptxGenJS) return Promise.resolve()
  if (pptxLibraryPromise) return pptxLibraryPromise

  const loading = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = url
    script.onload = () => {
      if (window.PptxGenJS) {
        resolve()
      } else {
        script.remove()
        reject(new Error("The PowerPoint generator did not load."))
      }
    }
    script.onerror = () => {
      script.remove()
      reject(new Error("The PowerPoint generator could not be loaded."))
    }
    document.head.append(script)
  })

  pptxLibraryPromise = loading.catch((error) => {
    pptxLibraryPromise = undefined
    throw error
  })
  return pptxLibraryPromise
}

export function createPresentation(model) {
  const pptx = new window.PptxGenJS()
  pptx.defineLayout({ name: "ELEF_16_9", width: 40 / 3, height: 7.5 })
  pptx.layout = "ELEF_16_9"
  pptx.author = "Elef"
  pptx.subject = `${model.presentation.title} · ${model.version}`
  pptx.title = model.presentation.title
  pptx.company = "Elef"
  const fonts = model.presentation.fonts
  const headingFace = primaryFont(model.presentation.typography === "technical" ? fonts.technical : fonts[model.presentation.typography])
  pptx.theme = {
    headFontFace: headingFace,
    bodyFontFace: primaryFont(fonts.body),
    lang: "en-US"
  }
  return pptx
}

export function primaryFont(stack) {
  const first = String(stack || REMOTE_FONT_FALLBACK).split(",")[0].trim()
  return first.replace(/^['"]|['"]$/g, "") || REMOTE_FONT_FALLBACK
}

export function createRenderStage(model) {
  const stage = document.createElement("div")
  stage.className = [
    "pptx-render-stage presentation-surface",
    `work-theme-${model.presentation.theme}`,
    `work-typography-${model.presentation.typography}`,
    `slides-theme-${model.presentation.theme}`,
    `slides-typography-${model.presentation.typography}`
  ].join(" ")
  stage.style.cssText = "position:fixed;left:-20000px;top:0;width:1280px;z-index:-1;opacity:0;pointer-events:none;"
  stage.innerHTML = model.slides.map((slide) => slideMarkup(slide, model)).join("")
  return stage
}

export function slideMarkup(slide, model) {
  const margin = model.margin_settings
  const topMargin = margin.section || margin.subsection
    ? `<div class="slide-margin slide-margin-top" aria-hidden="true">${margin.subsection ? `<span class="slide-margin-subsection">${escapeHtml(slide.subsection || "")}</span>` : ""}${margin.section ? `<span class="slide-margin-section">${escapeHtml(slide.section || "")}</span>` : ""}</div>`
    : ""
  const titlePosition = slide.title_position
  const titleClasses = titlePosition ? `position-${titlePosition.horizontal} position-${titlePosition.vertical}` : ""
  const content = slide.title_html
    ? `<div class="slide-content"><div class="slide-title slide-block ${titleClasses}">${slide.title_html}</div><div class="slide-regions">${slide.regions.map((region) => `<div class="slide-region">${region.map(blockMarkup).join("")}</div>`).join("")}</div></div>`
    : `<div class="slide-content">${slide.blocks.length ? slide.blocks.map(blockMarkup).join("") : '<p class="empty-slide">Empty slide</p>'}</div>`
  const footnote = margin.footnote && slide.footnote_html
    ? `<span class="slide-margin-footnote"><span class="slide-margin-footnote-marker">*</span><span class="slide-margin-footnote-text">${slide.footnote_html}</span></span>`
    : ""
  const bottomMargin = margin.slide_count || footnote
    ? `<div class="slide-margin slide-margin-bottom" aria-hidden="true">${margin.slide_count ? `<span class="slide-margin-count">${slide.index + 1} / ${model.slides.length}</span>` : ""}${footnote}</div>`
    : ""
  return `<div class="slide-frame" style="height:720px;width:1280px"><section class="slide slide-${escapeHtml(slide.layout)}" aria-label="Slide ${slide.index + 1}">${topMargin}${content}${bottomMargin}</section></div>`
}

export function blockMarkup(block) {
  const position = block.position
  const classes = position ? `position-${position.horizontal} position-${position.vertical}` : ""
  return `<div class="slide-block ${classes}">${block.html}</div>`
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character])
}

async function prepareMedia(stage) {
  const media = new Map()
  const objectUrls = []
  const fetchedMedia = new Map()
  const elements = [...stage.querySelectorAll("img[src], video[src]")]
  try {
    await Promise.all(elements.map(async (element) => {
      const source = element.getAttribute("src")
      let pending = fetchedMedia.get(source)
      if (!pending) {
        pending = source.startsWith("data:") ? Promise.resolve(source) : fetchAsDataUri(source)
        fetchedMedia.set(source, pending)
      }
      const data = await pending
      const blob = dataUriToBlob(data)
      const objectUrl = URL.createObjectURL(blob)
      objectUrls.push(objectUrl)
      element.src = objectUrl
      media.set(element, { data, contentType: blob.type || (element.tagName === "VIDEO" ? "video/mp4" : "image/png") })
      if (element.tagName === "IMG") await element.decode()
    }))
    await Promise.all([...stage.querySelectorAll(".katex")].map((math) => document.fonts.ready))
    return { media, objectUrls }
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
    throw error
  }
}

async function fetchAsDataUri(url) {
  const response = await fetch(url, { credentials: "same-origin" })
  if (!response.ok) throw new Error("A presentation image or video could not be loaded.")
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error("A presentation image or video could not be read."))
    reader.readAsDataURL(blob)
  })
}

export function dataUriToBlob(dataUri) {
  const [metadata, encoded] = dataUri.split(",", 2)
  const contentType = metadata.match(/^data:([^;]+)/)?.[1] || "application/octet-stream"
  const binary = metadata.includes(";base64") ? atob(encoded) : decodeURIComponent(encoded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: contentType })
}

async function renderSlides(pptx, stage, model, assets) {
  const frames = [...stage.querySelectorAll(".slide-frame")]
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const slide = model.slides[index]
    const pptxSlide = pptx.addSlide()
    const root = frame.querySelector(".slide")
    pptxSlide.addImage({ data: gradientBackground(model.presentation.theme), x: 0, y: 0, w: 40 / 3, h: 7.5 })
    if (slide.title_html) await addBlockElements(pptxSlide, root.querySelector(".slide-title"), root, assets, pptx.ShapeType)

    for (const block of root.querySelectorAll(".slide-block")) await addBlockElements(pptxSlide, block, root, assets, pptx.ShapeType)
    if (root.querySelector(".empty-slide")) addTextElement(pptxSlide, root.querySelector(".empty-slide"), root)
    await addMarginElements(pptxSlide, root, assets, pptx.ShapeType)
  }
}

async function addBlockElements(slide, block, root, assets, shapeTypes) {
  const content = [...block.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,pre,table,hr,img,video")]
  for (const element of content) {
    if (element.closest("pre") && element.tagName !== "PRE") continue
    if (element.closest("table") && element.tagName !== "TABLE") continue
    if (element.closest("li") && element.tagName === "P") continue
    if (element.matches(".katex")) continue
    if (element.matches("p,h1,h2,h3,h4,h5,h6,li,pre") && element.querySelector(".katex")) {
      addImageElement(slide, element, root, await katexBlockPng(element), element.getAttribute("aria-label") || "Mathematical expression")
    } else if (element.tagName === "TABLE") {
      addTableElement(slide, element, root)
    } else if (element.tagName === "IMG" || element.tagName === "VIDEO") {
      const media = assets.media.get(element)
      if (!media) continue
      if (element.tagName === "VIDEO") addVideoElement(slide, element, root, media)
      else addImageElement(slide, element, root, media.data, element.alt || "Presentation image")
    } else if (element.tagName === "HR") {
      addRule(slide, element, root, shapeTypes)
    } else if (element.tagName === "PRE") {
      addCodeElement(slide, element, root, shapeTypes)
    } else {
      addTextElement(slide, element, root, { list: element.tagName === "LI" })
    }
  }
}

async function addMarginElements(slide, root, assets, shapeTypes) {
  const top = root.querySelector(".slide-margin-top")
  const bottom = root.querySelector(".slide-margin-bottom")
  if (top) {
    const style = getComputedStyle(top)
    const left = top.querySelector(".slide-margin-subsection")
    const right = top.querySelector(".slide-margin-section")
    if (left) addMarginText(slide, left.textContent, relativeRect(left, root), style)
    if (right) addMarginText(slide, right.textContent, relativeRect(right, root), style)
  }
  if (!bottom) return

  const count = bottom.querySelector(".slide-margin-count")
  if (count) addMarginText(slide, count.textContent, relativeRect(count, root), getComputedStyle(bottom))
  const footnote = bottom.querySelector(".slide-margin-footnote")
  if (footnote) {
    const footnoteText = footnote.querySelector(".slide-margin-footnote-text")
    if (footnoteText?.querySelector(".katex")) await addBlockElements(slide, footnoteText, root, assets, shapeTypes)
    else if (footnoteText) addTextElement(slide, footnoteText, root)
    const marker = footnote.querySelector(".slide-margin-footnote-marker")
    if (marker) addTextElement(slide, marker, root)
  }
}

function addMarginText(slide, text, rect, style) {
  const box = pixelRectToInches(rect)
  const displayText = style.textTransform === "uppercase" ? String(text).toLocaleUpperCase() : text
  slide.addText(displayText || " ", {
    ...box, margin: 0, breakLine: false,
    fontFace: fontFace(style), fontSize: cssFontSize(style),
    color: colorHex(style.color), charSpacing: cssCharSpacing(style),
    bold: parseInt(style.fontWeight, 10) >= 600,
    align: style.textAlign === "right" ? "right" : "left", valign: "mid"
  })
}

function addTextElement(slide, element, root, { list = false } = {}) {
  const rect = relativeRect(element, root)
  if (rect.width < 1 || rect.height < 1) return
  const style = getComputedStyle(element)
  const runs = element.querySelector(".katex") ? [] : richTextRuns(element)
  if (element.querySelector(".katex")) return
  const text = runs.length ? runs : [{ text: element.textContent || " " }]
  const box = pixelRectToInches(rect)
  const options = textOptions(style, box)
  if (list) {
    const listElement = element.parentElement
    const ordered = listElement?.tagName === "OL"
    const siblings = [...(listElement?.children || [])].filter((child) => child.tagName === "LI")
    const position = siblings.indexOf(element)
    const start = Number(listElement?.getAttribute("start") || 1) + Math.max(position, 0)
    const indent = Math.max(cssFontSize(style) * 0.9, 10)
    options.bullet = ordered ? { type: "number", numberStartAt: start, indent } : { indent }
    options.x = Math.max(0, options.x - indent / 72)
    options.w += indent / 72
  }
  slide.addText(text, options)
}

function richTextRuns(element, { preserveWhitespace = false } = {}) {
  const runs = []
  const baseStyle = textRunStyle(element)
  const append = (text, style) => {
    const normalized = preserveWhitespace ? String(text) : String(text).replace(/[\t\r\n ]+/g, " ")
    if (!normalized) return
    const options = runOptions(style, baseStyle)
    const previous = runs[runs.length - 1]
    if (previous && JSON.stringify(previous.options) === JSON.stringify(options)) previous.text += normalized
    else runs.push({ text: normalized, options })
  }
  const visit = (node, inherited) => {
    if (node.nodeType === Node.TEXT_NODE) {
      append(node.nodeValue, inherited)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    if (["IMG", "VIDEO", "UL", "OL"].includes(node.tagName) || node.matches(".katex-mathml")) return
    if (node.tagName === "BR") {
      append("\n", inherited)
      return
    }
    const next = textRunStyle(node, inherited.hyperlink)
    if (node.matches(".katex")) {
      const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent
      if (tex) append(` ${tex} `, inherited)
      return
    }
    node.childNodes.forEach((child) => visit(child, next))
  }
  element.childNodes.forEach((node) => visit(node, baseStyle))
  if (runs.length && !preserveWhitespace) {
    runs[0].text = runs[0].text.replace(/^ +/, "")
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ +$/, "")
  }
  return runs.filter((run) => run.text)
}

function textRunStyle(element, inheritedHyperlink) {
  const style = getComputedStyle(element)
  const link = element.tagName === "A" ? element.getAttribute("href") : inheritedHyperlink
  return {
    bold: parseInt(style.fontWeight, 10) >= 600,
    italic: style.fontStyle === "italic" || style.fontStyle === "oblique",
    strike: style.textDecorationLine.includes("line-through"),
    underline: style.textDecorationLine.includes("underline"),
    color: colorHex(style.color),
    fontFace: fontFace(style),
    fontSize: cssFontSize(style),
    charSpacing: cssCharSpacing(style),
    code: element.tagName === "CODE" || element.tagName === "PRE",
    hyperlink: link && safeHyperlink(link) ? { url: link } : undefined,
    subscript: element.tagName === "SUB",
    superscript: element.tagName === "SUP"
  }
}

function textOptions(style, box) {
  const fontSize = cssFontSize(style)
  const lineSpacingMultiple = cssLineSpacingMultiple(style)
  const options = {
    ...box,
    margin: 0,
    valign: "top",
    fontFace: fontFace(style),
    fontSize,
    charSpacing: cssCharSpacing(style),
    color: colorHex(style.color),
    bold: parseInt(style.fontWeight, 10) >= 600,
    italic: style.fontStyle === "italic" || style.fontStyle === "oblique",
    align: { start: "left", end: "right" }[style.textAlign] || style.textAlign,
    breakLine: false
  }
  if (lineSpacingMultiple > 0.6 && lineSpacingMultiple < 3) options.lineSpacingMultiple = lineSpacingMultiple
  if (style.textDecorationLine.includes("line-through")) options.strike = "sngStrike"
  if (style.textDecorationLine.includes("underline")) options.underline = { style: "sng" }
  return options
}

export function cssLineSpacingMultiple(style) {
  const lineHeight = parseFloat(style.lineHeight)
  const fontSize = cssFontSize(style)
  return Number.isFinite(lineHeight) && fontSize > 0 ? (lineHeight * 0.75) / fontSize : 1.1
}

function runOptions(style, baseStyle) {
  const options = {}
  if (style.bold !== baseStyle.bold) options.bold = style.bold
  if (style.italic !== baseStyle.italic) options.italic = style.italic
  if (style.strike) options.strike = "sngStrike"
  if (style.underline) options.underline = { style: "sng" }
  if (style.color !== baseStyle.color) options.color = style.color
  if (style.fontFace !== baseStyle.fontFace) options.fontFace = style.fontFace
  if (style.fontSize !== baseStyle.fontSize) options.fontSize = style.fontSize
  if (style.charSpacing !== baseStyle.charSpacing) options.charSpacing = style.charSpacing
  if (style.hyperlink) options.hyperlink = style.hyperlink
  if (style.subscript) options.subscript = true
  if (style.superscript) options.superscript = true
  return options
}

function addCodeElement(slide, element, root, shapeTypes) {
  const rect = relativeRect(element, root)
  const box = pixelRectToInches(rect)
  const style = getComputedStyle(element)
  const code = element.querySelector("code") || element
  const runs = richTextRuns(code, { preserveWhitespace: true })
  const borderWidth = parseFloat(style.borderTopWidth) || 0
  const borderColor = colorHex(style.borderTopColor)
  slide.addShape(shapeTypes.roundRect, {
    ...box, rectRadius: 0.06,
    fill: { color: "191714" },
    line: { color: borderColor, transparency: borderWidth ? 80 : 100, width: borderWidth / 1.333 }
  })
  const padLeft = (parseFloat(style.paddingLeft) || 0) / PX_PER_INCH
  const padTop = (parseFloat(style.paddingTop) || 0) / PX_PER_INCH
  const textBox = { ...box, x: box.x + padLeft, y: box.y + padTop, w: Math.max(0.1, box.w - padLeft * 2), h: Math.max(0.1, box.h - padTop * 2) }
  slide.addText(runs, {
    ...textBox, margin: 0, valign: "top", fontFace: fontFace(style), fontSize: cssFontSize(style),
    color: colorHex(style.color), lineSpacingMultiple: cssLineSpacingMultiple(style) || 1.5,
    breakLine: false, wrap: false
  })
}

function addTableElement(slide, table, root) {
  const rect = relativeRect(table, root)
  const box = pixelRectToInches(rect)
  const tableRows = [...table.querySelectorAll("tr")].map((row) => [...row.children].map((cell) => {
    const style = getComputedStyle(cell)
    return {
      text: cellTextRuns(cell),
      options: {
        bold: cell.tagName === "TH" || parseInt(style.fontWeight, 10) >= 600,
        color: colorHex(style.color),
        fill: { color: rootThemeColor(table) },
        fontFace: fontFace(style), fontSize: cssFontSize(style),
        charSpacing: cssCharSpacing(style),
        align: { start: "left", end: "right" }[style.textAlign] || style.textAlign,
        valign: "mid", margin: [4.2, 6, 4.2, 6],
        border: { type: "solid", color: "DDD5C8", pt: 0.75 }
      }
    }
  }))
  const firstRow = table.querySelector("tr")
  const cells = firstRow ? [...firstRow.children] : []
  const colW = cells.map((cell) => relativeRect(cell, table).width / PX_PER_INCH)
  const rowH = [...table.querySelectorAll("tr")].map((row) => relativeRect(row, table).height / PX_PER_INCH)
  if (!tableRows.length) return
  slide.addTable(tableRows, {
    ...box, margin: 0, border: { type: "solid", color: "DDD5C8", pt: 0.75 },
    colW: colW.length ? colW : undefined, rowH: rowH.length ? rowH : undefined,
    autoPage: false, fontFace: REMOTE_FONT_FALLBACK, fontSize: 16,
    color: "252A27", breakLine: false, valign: "mid"
  })
}

function cellTextRuns(cell) {
  const style = getComputedStyle(cell)
  return richTextRuns(cell).map(({ text, options }) => ({ text, options }))
}

function rootThemeColor(element) {
  return element.closest(".pptx-render-stage")?.classList.contains("work-theme-dark") ? "202C32" : "FCFAF5"
}

function addImageElement(slide, element, root, data, alt) {
  const box = pixelRectToInches(relativeRect(element, root))
  const sizing = element.tagName === "IMG" && getComputedStyle(element).objectFit === "cover" ? "cover" : "contain"
  const intrinsicWidth = element.naturalWidth || element.videoWidth || 1
  const intrinsicHeight = element.naturalHeight || element.videoHeight || 1
  const boxRatio = box.w / Math.max(box.h, 0.001)
  const mediaRatio = intrinsicWidth / intrinsicHeight
  let options = box
  if (sizing === "contain") {
    if (mediaRatio > boxRatio) {
      const height = box.w / mediaRatio
      options = { ...box, y: box.y + (box.h - height) / 2, h: height }
    } else {
      const width = box.h * mediaRatio
      options = { ...box, x: box.x + (box.w - width) / 2, w: width }
    }
    slide.addImage({ data, ...options, altText: alt })
  } else {
    slide.addImage({ data, ...box, sizing: { type: "cover", w: box.w, h: box.h }, altText: alt })
  }
}

function addVideoElement(slide, element, root, media) {
  const box = pixelRectToInches(relativeRect(element, root))
  slide.addMedia({
    type: "video", data: media.data, extn: "mp4", ...box,
    objectName: element.getAttribute("aria-label") || "Embedded video"
  })
}

function addRule(slide, element, root, shapeTypes) {
  const rect = relativeRect(element, root)
  const y = rect.top + rect.height / 2
  slide.addShape(shapeTypes.line, {
    x: rect.left / PX_PER_INCH, y: y / PX_PER_INCH, w: rect.width / PX_PER_INCH, h: 0,
    line: { color: "DDD5C8", width: 1 }
  })
}

export function relativeRect(element, root) {
  const rect = element.getBoundingClientRect()
  const base = root.getBoundingClientRect()
  return { left: rect.left - base.left, top: rect.top - base.top, width: rect.width, height: rect.height }
}

export function pixelRectToInches(rect) {
  return {
    x: rect.left / PX_PER_INCH,
    y: rect.top / PX_PER_INCH,
    w: Math.max(0.001, rect.width / PX_PER_INCH),
    h: Math.max(0.001, rect.height / PX_PER_INCH)
  }
}

function fontFace(style) {
  return primaryFont(style.fontFamily)
}

export function cssFontSize(style) {
  return Math.max(1, (parseFloat(style.fontSize) || 16) * 0.75)
}

export function cssCharSpacing(style) {
  const letterSpacing = parseFloat(style.letterSpacing)
  return Number.isFinite(letterSpacing) ? letterSpacing * 0.75 : 0
}

export function colorHex(color, fallback = "252A27") {
  if (!color || color === "transparent") return fallback
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length < 3) return fallback
  return channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("").toUpperCase()
}

export function safeHyperlink(url) {
  return /^(https?:|mailto:|tel:)/i.test(url)
}

export function gradientBackground(theme) {
  const [start, end, border] = {
    dark: ["#202c32", "#11161a", "#304047"],
    light: ["#fffdf8", "#f5f0e7", "#d8d0c2"],
    match: ["#fcfaf5", "#f5f0e7", "#d8d0c2"]
  }[theme] || ["#fcfaf5", "#f5f0e7", "#d8d0c2"]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect x="0.5" y="0.5" width="1279" height="719" rx="10" fill="url(#g)" stroke="${border}"/></svg>`
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

async function katexBlockPng(element) {
  const clone = element.cloneNode(true)
  inlineComputedStyles(element, clone)
  clone.querySelectorAll(".katex-mathml").forEach((mathml) => mathml.remove())
  const rect = element.getBoundingClientRect()
  const serializer = new XMLSerializer()
  const markup = serializer.serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${Math.ceil(rect.width * 2)}" height="${Math.ceil(rect.height * 2)}"><foreignObject width="100%" height="100%"><xhtml:div xmlns="http://www.w3.org/1999/xhtml" style="width:${rect.width}px;height:${rect.height}px">${markup}</xhtml:div></foreignObject></svg>`
  const image = await new Promise((resolve, reject) => {
    const rendered = new Image()
    rendered.onload = () => resolve(rendered)
    rendered.onerror = () => reject(new Error("A mathematical expression could not be rendered."))
    rendered.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil(rect.width * 2)
  canvas.height = Math.ceil(rect.height * 2)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A mathematical expression could not be rendered.")
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  if (!pixels.some((channel, index) => index % 4 === 3 && channel > 0)) {
    throw new Error("A mathematical expression could not be rendered.")
  }
  return canvas.toDataURL("image/png")
}

function inlineComputedStyles(source, target) {
  const style = getComputedStyle(source)
  const inline = [...style].map((property) => `${property}:${style.getPropertyValue(property)}`).join(";")
  target.setAttribute("style", inline)
  const sourceChildren = [...source.children]
  const targetChildren = [...target.children]
  sourceChildren.forEach((child, index) => inlineComputedStyles(child, targetChildren[index]))
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.style.display = "none"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
