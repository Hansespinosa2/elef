module PresentationsHelper
  def render_markdown(markdown)
    Presentations::MarkdownRenderer.render(markdown)
  end

  def position_classes(position)
    return "" unless position

    "position-#{position.horizontal} position-#{position.vertical}"
  end
end
