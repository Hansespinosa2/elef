export function blockOperationStart(slide, block) {
  const starts = [block.range.start]
  if (Number.isInteger(block.art?.source_range?.start)) starts.push(block.art.source_range.start)
  if (block.position_scope === "block" && block.position_directive_id) {
    const directive = slide.directives.find(candidate => candidate.id === block.position_directive_id)
    if (directive) starts.push(directive.range.start)
  }
  return Math.min(...starts)
}

export function blockOperationRange(slide, block) {
  let start = blockOperationStart(slide, block)
  let end = block.range.end
  if (block.position_scope !== "group" || !block.position_directive_id) return { start, end }

  const groupMembers = slide.blocks.filter(candidate => candidate.position_directive_id === block.position_directive_id)
  if (groupMembers.length !== 1) return { start, end }

  const directiveIndex = slide.directives.findIndex(candidate => candidate.id === block.position_directive_id)
  const directive = slide.directives[directiveIndex]
  if (!directive) return { start, end }
  start = Math.min(start, directive.range.start)

  const closing = slide.directives.slice(directiveIndex + 1).find(candidate => candidate.type === "position_close")
  if (closing) end = Math.max(end, closing.range.end)
  return { start, end }
}
