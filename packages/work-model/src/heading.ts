// First-h1 extraction shared by every host. This lives outside the document
// link/graph slices on purpose: the desktop Stable profile excludes those
// modules from its bundle (OQ-A4), but host code such as the Tauri title
// sync still needs the heading. Pure string parsing, no link machinery.
interface CodeFence {
  character: string;
  length: number;
}

export function extractFirstMarkdownHeading(source: string = ""): string | null {
  if (typeof source !== "string") return null
  const lines = source.split(/\r\n?|\n/)
  let firstBodyLine = 0

  if (lines[0]?.replace(/^\uFEFF/, "").trimEnd() === "---") {
    const closingLine = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---")
    if (closingLine > 0 && lines.slice(1, closingLine).some(line => /^[A-Za-z_][\w-]*\s*:/.test(line))) {
      firstBodyLine = closingLine + 1
    }
  }

  let fence: CodeFence | null = null
  for (const line of lines.slice(firstBodyLine)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      const run = marker[1] ?? ""
      const rest = marker[2] ?? ""
      if (!fence) fence = { character: run[0] ?? "", length: run.length }
      else if (run[0] === fence.character && run.length >= fence.length && !rest.trim()) fence = null
      continue
    }
    if (fence) continue

    const heading = line.match(/^\s{0,3}#(?!#)\s+(.+?)\s*#*\s*$/)
    if (heading) return (heading[1] ?? "").trim()
  }
  return null
}
