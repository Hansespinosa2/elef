module PresentationsHelper
  def render_markdown(markdown)
    Presentations::MarkdownRenderer.render(markdown)
  end
end
