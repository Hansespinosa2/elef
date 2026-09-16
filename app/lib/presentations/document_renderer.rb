module Presentations
  module DocumentRenderer
    module_function

    def render(source, source_name: "Untitled document", parsed: nil)
      parsed ||= Presentations::Document.parse(source.to_s, source_name: source_name, mode: :document)
      slide = parsed.slides.first
      return "".html_safe unless slide

      if slide.blocks.any? { |block| block.position }
        slide.blocks.map do |block|
          classes = position_classes(block.position)
          %(<div class="document-block #{classes}">#{Presentations::MarkdownRenderer.render(block.markdown)}</div>)
        end.join.html_safe
      else
        Presentations::MarkdownRenderer.render(slide.markdown)
      end
    end

    def position_classes(position)
      return "" unless position

      "position-#{position.horizontal} position-#{position.vertical}"
    end
  end
end
