// Shared PPTX model builder: ports Presentations::PptxExport#as_json
// (apps/web/app/services/presentations/pptx_export.rb: slide_payload,
// block_payload, filename) onto work-model + renderer for hosts without a
// server. The web host keeps serving model JSON over HTTP; the desktop
// builds the identical shape from local source and feeds the same engine
// (features/export/pptx), so both hosts emit the same PPTX bytes for the
// same Work. Remote images stay URLs in the model: the shared engine embeds
// them at prepareMedia time, matching the server, which inlines them before
// serving. This module ships as the deferred @elef/client/pptx-model entry,
// never in the boot barrel: the projection (KaTeX, highlight.js,
// markdown-it) stays out of the boot entry like preview-core.
import { buildEditorStructure } from "@elef/work-model/document-map"
import type { ParsedBlock } from "@elef/work-model/document-map"
import { collectMediaReferences, renderMarkdownBlock } from "@elef/renderer"
import type { MediaMap } from "@elef/renderer"
import type { PptxModel, PptxRegionBlock } from "./pptx.js"

// Presentation font stacks, ported from Presentations::PptxExport::FONTS.
// The engine reads technical/body plus the active typography face.
const FONTS = {
  body: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  book: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif',
  modern: 'Baskerville, "Iowan Old Style", Georgia, serif',
  technical: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  code: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
}

// Slide canvas in pixels, ported from Presentations::PptxExport::WIDTH/HEIGHT.
// The engine renders the off-screen stage at the same size.
const SLIDE_WIDTH = 1280
const SLIDE_HEIGHT = 720

const ELEF_ASSET_REFERENCE = /^elef-asset:[a-f0-9]{64}$/i

// Reserved filename characters, ported from the normalize_folder_name
// character class (Source::Document). Control characters are matched by code
// point below instead of a character range.
const RESERVED_FILENAME_CHARS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"])

export interface PptxModelInput {
  source: string
  title?: string
  version?: string
  mediaMap?: MediaMap
  mediaBaseUrl?: string
  documentNodes?: ReadonlyArray<unknown>
}

// The engine input plus the host delivery name: the web host reads filename
// from the served JSON, the desktop save dialog from this field.
export interface PptxExportModel extends PptxModel {
  filename: string
}

export function buildPptxModel(input: PptxModelInput): PptxExportModel {
  const title = input.title ?? "Untitled"
  const structure = buildEditorStructure(input.source, { sourceName: title, mode: "presentation" })
  const mediaMap = input.mediaMap ?? {}
  const mediaBaseUrl = input.mediaBaseUrl ?? ""
  const documentNodes = input.documentNodes ?? []
  assertAssetsResolvable(input.source, mediaMap, mediaBaseUrl)
  const render = (markdown: string): string =>
    renderMarkdownBlock(markdown, { mediaMap, mediaBaseUrl, allowRemoteMedia: true, documentNodes })
  return {
    filename: `${normalizeExportFilename(title)}.pptx`,
    version: input.version ?? "draft",
    presentation: {
      title,
      theme: structure.style.theme,
      typography: structure.style.typography,
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      fonts: { ...FONTS }
    },
    margin_settings: { ...structure.marginSettings },
    slides: structure.slides.map((slide, index) => ({
      index,
      layout: slide.layout,
      title_html: slide.title ? render(slide.title) : null,
      title_position: slide.title ? slide.blocks[0]?.position ?? null : null,
      blocks: slide.blocks.map((block) => blockPayload(block, render)),
      regions: slide.regions.map((region) => region.map((block) => blockPayload(block, render))),
      section: slide.section,
      subsection: slide.subsection,
      footnote_html: slide.footnote ? render(slide.footnote) : null
    }))
  }
}

function blockPayload(block: ParsedBlock, render: (markdown: string) => string): PptxRegionBlock {
  return { html: render(block.markdown), position: block.position }
}

// The server raises when an Elef attachment reference has no blob; fail the
// same way here instead of silently dropping the image. A media base URL
// resolves digests without a map, so explicit verification only applies to
// map-backed builds.
function assertAssetsResolvable(source: string, mediaMap: MediaMap, mediaBaseUrl: string): void {
  if (mediaBaseUrl) return
  for (const reference of collectMediaReferences(source)) {
    if (ELEF_ASSET_REFERENCE.test(reference) && typeof mediaMap[reference]?.src !== "string") {
      throw new Error("A referenced Elef image or video is unavailable for PPTX export.")
    }
  }
}

// Ported from Source::Document.normalize_folder_name: reserved path
// characters become spaces, runs collapse, trailing dots/spaces trim, and
// blank or dot-only results fall back. Ruby slices 120 characters; so do we.
export function normalizeExportFilename(title: string, fallback = "Presentation"): string {
  const value = [...(title || fallback).normalize("NFKC")]
    .map((character) =>
      RESERVED_FILENAME_CHARS.has(character) || (character.codePointAt(0) ?? 0) <= 0x1f ? " " : character
    )
    .join("")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .trim()
  if (!value || value === "." || value === "..") return fallback
  return value.slice(0, 120)
}
