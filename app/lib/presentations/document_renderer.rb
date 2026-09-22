module Presentations
  module DocumentRenderer
    module_function

    def render(source, source_name: "Untitled document", parsed: nil, documents: nil)
      parsed ||= Presentations::Document.parse(source.to_s, source_name: source_name, mode: :document)
      documents ||= ::Document.all.to_a
      slide = parsed.slides.first
      return "".html_safe unless slide

      if slide.blocks.any? { |block| block.position }
        slide.blocks.map do |block|
          classes = position_classes(block.position)
          %(<div class="document-block #{classes}">#{DocumentLinks::Renderer.render(block.markdown, documents: documents)}</div>)
        end.join.html_safe
      else
        DocumentLinks::Renderer.render(slide.markdown, documents: documents)
      end
    end

    def position_classes(position)
      return "" unless position

      classes = ["position-#{position.horizontal}", "position-#{position.vertical}"]
      classes << "position-vertical" if position.vertical_explicit
      classes.join(" ")
    end
  end
end
