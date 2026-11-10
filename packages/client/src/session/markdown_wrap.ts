// A code span needs a delimiter longer than any backtick run in its text.
// Padding protects literal edge backticks and preserves paired edge spaces.
export function markdownWrapMarkers(text: string, marker: "*" | "`"): { open: string; close: string } {
  if (marker === "*") return { open: marker, close: marker }
  let longest = 0
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  const ticks = "`".repeat(longest + 1)
  const padding = text.startsWith("`") || text.endsWith("`") ||
    (text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "") ? " " : ""
  return { open: ticks + padding, close: padding + ticks }
}
