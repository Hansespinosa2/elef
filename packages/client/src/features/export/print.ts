// Shared desktop/web print contract (P07-06 companion to the export registry):
// which Work kinds print through which marker classes, which page geometry
// the print CSS must honor, and the pre-print DOM preparation both hosts
// share. The desktop `printCurrentWork` flow and the web `print-view`
// controller implement the same preparation; the geometry constants pin the
// web print views (`documents/print`, `presentations/print` + components/
// documents.css) so desktop CSS parity is machine-checked, never eyeballed.

export type PrintWorkKind = "document" | "presentation"

export const PRINT_MARKER = "printing-work"
export const PRINT_DOCUMENT_MARKER = "printing-document"
export const PRINT_PRESENTATION_MARKER = "printing-presentation"

// Mirrors the preview-context kind rule in the desktop shell
// (`activeWorkFolder?.source_file === "document.md"`): documents print as
// documents, everything else prints as a presentation.
export function printWorkKindForSourceFile(sourceFile: string | null | undefined): PrintWorkKind {
  return sourceFile === "document.md" ? "document" : "presentation"
}

export function printMarkerClasses(kind: PrintWorkKind): Array<string> {
  return [PRINT_MARKER, kind === "document" ? PRINT_DOCUMENT_MARKER : PRINT_PRESENTATION_MARKER]
}

// Web print geometry, duplicated here as the single checked source of truth.
// Values must match `apps/web/app/assets/stylesheets/components/documents.css`:
// presentations print one fixed 16:9 landscape page per slide with 5rem slide
// padding; documents print flowing A4 portrait pages with 16mm page padding.
export const PRESENTATION_PRINT_GEOMETRY = {
  widthIn: 13.333,
  heightIn: 7.5,
  paddingRem: 5,
} as const

export const DOCUMENT_PRINT_GEOMETRY = {
  widthMm: 210,
  heightMm: 297,
  paddingMm: 16,
} as const

interface PauseableVideo {
  pause(): void
  currentTime?: unknown
}

interface VideoQueryable {
  querySelectorAll(selector: string): Iterable<PauseableVideo> | ArrayLike<PauseableVideo>
}

// Pause every video under the print root and rewind it, mirroring the web
// `print-view` Stimulus controller: PDFs never carry video playback, and a
// playing video would print its current frame instead of the poster.
export function pausePrintVideos(root: VideoQueryable | null | undefined): void {
  if (!root) return
  const videos = root.querySelectorAll("video")
  for (const video of Array.from(videos as ArrayLike<PauseableVideo>)) {
    try {
      video.pause()
    } catch {
      // A video that refuses to pause must not block printing.
    }
    try {
      video.currentTime = 0
    } catch {
      // Read-only currentTime (or a detached node) prints the poster frame.
    }
  }
}
