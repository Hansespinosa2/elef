module Presentations
  module DocumentRenderer
    module_function

    def render(source, source_name: "Untitled document", parsed: nil, documents: nil, workspace: nil, editable: false, editor_map: nil)
      parsed ||= Presentations::Document.parse(source.to_s, source_name: source_name, mode: :document)
      workspace ||= documents&.first&.workspace || Workspace.default
      documents ||= ::Document.where(workspace: workspace).to_a
      slide = parsed.slides.first
      return "".html_safe unless slide

      if editable
        editor_map ||= Presentations::Document.editor_map(source.to_s.gsub(/\r\n?/, "\n"), source_name: source_name, mode: :document)
        mapped_blocks = editor_map.dig(:slides, 0, :blocks) || []
        html = slide.blocks.map.with_index do |block, index|
          mapped = mapped_blocks[index]
          classes = position_classes(block.position)
          class_names = ["document-editor-block", classes].reject(&:blank?).join(" ")
          attributes = if mapped
            %( class="#{ERB::Util.html_escape(class_names)}" data-editor-region-id="#{ERB::Util.html_escape(mapped[:editable_region_id].to_s)}" data-editor-block-id="#{ERB::Util.html_escape(mapped[:id].to_s)}" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur")
          else
            %( class="#{ERB::Util.html_escape(class_names)}" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur")
          end
          rendered = DocumentLinks::Renderer.render(block.markdown, documents: documents, workspace: workspace)
          rendered = editable_media(rendered, block.markdown) if mapped&.dig(:kind) == "image"
          %(<div#{attributes}>#{rendered}</div>)
        end.join
        return html.html_safe
      end

      if slide.blocks.any? { |block| block.position }
        slide.blocks.map do |block|
          classes = position_classes(block.position)
          %(<div class="document-block #{classes}">#{DocumentLinks::Renderer.render(block.markdown, documents: documents, workspace: workspace)}</div>)
        end.join.html_safe
      else
        DocumentLinks::Renderer.render(slide.markdown, documents: documents, workspace: workspace)
      end
    end

    def position_classes(position)
      return "" unless position

      classes = ["position-#{position.horizontal}", "position-#{position.vertical}"]
      classes << "position-vertical" if position.vertical_explicit
      classes.join(" ")
    end

    def editable_media(rendered, markdown)
      alt = markdown.to_s.match(/\A\s*!\[([^\]]*)\]/)&.[](1).to_s
      %(<figure class="editor-media">#{rendered}<figcaption class="editor-media-caption">#{ERB::Util.html_escape(alt)}</figcaption></figure>)
    end
  end
end
