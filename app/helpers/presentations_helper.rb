module PresentationsHelper
  def render_markdown(markdown)
    Presentations::MarkdownRenderer.render(markdown)
  end

  def lineage_depth(presentation, seen = {})
    return 0 unless presentation.parent
    return 0 if seen[presentation.id]

    lineage_depth(presentation.parent, seen.merge(presentation.id => true)) + 1
  end

  def lineage_root(presentation, seen = {})
    return presentation if presentation.parent.nil? || seen[presentation.id]

    lineage_root(presentation.parent, seen.merge(presentation.id => true))
  end

  def lineage_layout(presentations, root)
    children_by_parent = presentations.group_by(&:parent_id)
    rows = {}
    next_row = 0

    assign_row = lambda do |presentation|
      children = children_by_parent[presentation.id] || []
      child_rows = children.sort_by(&:id).map { |child| assign_row.call(child) }
      row = if child_rows.empty?
        current_row = next_row
        next_row += 1
        current_row
      else
        (child_rows.first + child_rows.last) / 2.0
      end
      rows[presentation.id] = { column: lineage_depth(presentation) + 1, row: row + 1 }
      row
    end

    assign_row.call(root)
    rows
  end
end
