module Presentations
  module DocumentRenderer
    module_function

    def render(source, source_name: "Untitled document", parsed: nil, documents: nil, workspace: nil, media_resolver: nil, editable: false, editor_map: nil)
      parsed ||= Presentations::Document.parse(source.to_s, source_name: source_name, mode: :document)
      workspace ||= documents&.first&.workspace || Workspace.default
      documents ||= ::Document.where(workspace: workspace).to_a
      slide = parsed.slides.first
      return "".html_safe unless slide

      if editable
        editor_map ||= Presentations::Document.editor_map(source.to_s.gsub(/\r\n?/, "\n"), source_name: source_name, mode: :document)
        mapped_blocks = editor_map.dig(:slides, 0, :blocks) || []
        mapped_regions = editor_map.dig(:slides, 0, :editable_regions) || []
        html = slide.blocks.map.with_index do |block, index|
          mapped = mapped_blocks[index]
          region = mapped_regions.find { |candidate| candidate[:block_id] == mapped&.dig(:id) }
          valid_mapping = valid_editable_mapping?(mapped, region, block.markdown, editor_map[:source_length])
          classes = position_classes(block.position)
          class_names = ["document-editor-block", classes].reject(&:blank?).join(" ")
          if valid_mapping
            attributes = %( class="#{ERB::Util.html_escape(class_names)}" data-editor-region-id="#{ERB::Util.html_escape(mapped[:editable_region_id].to_s)}" data-editor-block-id="#{ERB::Util.html_escape(mapped[:id].to_s)}" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur")
          else
            attributes = %( class="#{ERB::Util.html_escape(class_names)}" contenteditable="false" aria-readonly="true")
          end
          rendered = DocumentLinks::Renderer.render(block.markdown, documents: documents, workspace: workspace, media_resolver: media_resolver)
          rendered = editable_media(rendered, block.markdown) if valid_mapping && mapped[:kind] == "image"
          %(<div#{attributes}>#{rendered}</div>)
        end.join
        return html.html_safe
      end

      if slide.blocks.any? { |block| block.position }
        rendered = slide.blocks.map.with_index do |block, index|
          classes = position_classes(block.position)
          line = source_line_for(source, block.markdown, index)
          %(<div class="document-block #{classes}" data-source-anchor="line-#{line}" data-source-line="#{line}">#{DocumentLinks::Renderer.render(block.markdown, documents: documents, workspace: workspace, media_resolver: media_resolver)}</div>)
        end.join.html_safe
      else
        annotate_source_anchors(
          DocumentLinks::Renderer.render(slide.markdown, documents: documents, workspace: workspace, media_resolver: media_resolver),
          source
        )
      end
    end

    def annotate_source_anchors(html, source)
      lines = source_anchor_lines(source)
      tag_index = 0
      annotated = html.to_s.gsub(/<(h[1-6]|p|ul|ol|pre|blockquote|table|hr)(?=\s|>)/i) do |opening|
        line = lines[[tag_index, lines.length - 1].min] || 1
        tag_index += 1
        %(<span class="document-source-anchor" data-source-anchor="line-#{line}" data-source-line="#{line}" aria-hidden="true"></span>#{opening})
      end
      return annotated.html_safe if tag_index.positive?

      %(<div class="document-anchor-root" data-source-anchor="document-root" data-source-line="1">#{annotated}</div>).html_safe
    end

    def source_anchor_lines(source)
      front_matter = Presentations::Document.initial_front_matter(source.to_s)
      body_line = front_matter ? source.to_s[0...front_matter.body_start].to_s.count("\n") + 1 : 1
      lines = source.to_s.lines.each_with_index.filter_map do |line, index|
        next if index + 1 < body_line || line.strip.blank? || line.match?(/\A\s*:::/)

        index + 1
      end
      lines.presence || [body_line]
    end

    def source_line_for(source, markdown, offset)
      needle = markdown.to_s.lines.first.to_s.strip
      line = source.to_s.lines.find_index { |candidate| candidate.strip == needle }
      line ? line + 1 : source_anchor_lines(source)[offset] || 1
    end

    def valid_editable_mapping?(mapped, region, markdown, source_length)
      return false unless mapped && region && region[:editable]
      return false unless mapped[:markdown] == markdown && mapped[:editable_region_id] == region[:id]
      return false unless region[:block_id] == mapped[:id]

      range = region[:content_range]
      range.is_a?(Hash) && range[:start].is_a?(Integer) && range[:end].is_a?(Integer) &&
        range[:start] >= 0 && range[:start] <= range[:end] && range[:end] <= source_length.to_i
    end

    def position_classes(position)
      return "" unless position

      classes = ["position-#{position.horizontal}", "position-#{position.vertical}"]
      classes << "position-vertical" if position.vertical_explicit
      classes.join(" ")
    end

    def editable_media(rendered, markdown)
      alt = markdown.to_s.match(/\A\s*!\[([^\]]*)\]/)&.[](1).to_s
      %(<figure class="editor-media">#{rendered}<figcaption class="editor-media-caption" aria-label="Editable image alt text" title="Edit image alt text">#{ERB::Util.html_escape(alt)}</figcaption></figure>)
    end
  end
end
