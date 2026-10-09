export function blockOperationStart(slide, block) {
  const starts = [block.range.start]
  if (Number.isInteger(block.art?.source_range?.start)) starts.push(block.art.source_range.start)
  if (block.position_directive_id) {
    const directive = slide.directives.find(candidate => candidate.id === block.position_directive_id)
    if (directive) starts.push(directive.range.start)
  }
  return Math.min(...starts)
}

export function blockOperationRange(slide, block) {
  const start = blockOperationStart(slide, block)
  const end = block.range.end
  return { start, end }
}
