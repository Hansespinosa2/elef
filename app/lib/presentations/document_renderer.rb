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
        mapped_content_blocks = mapped_blocks.reject { |mapped| mapped[:empty_placeholder] }
        empty_blocks = mapped_blocks.select { |mapped| mapped[:empty_placeholder] }
        mapped_regions = editor_map.dig(:slides, 0, :editable_regions) || []
        html = +""
        empty_block_index = 0
        append_empty_block = lambda do |mapped|
          region = mapped_regions.find { |candidate| candidate[:block_id] == mapped[:id] }
          next unless region&.dig(:editable)

          html << %(<div class="document-editor-block" data-editor-region-id="#{ERB::Util.html_escape(region[:id])}" data-editor-block-id="#{ERB::Util.html_escape(mapped[:id])}" data-editor-empty-block="true" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur"><p><br></p></div>)
        end
        slide.blocks.each_with_index do |block, index|
          mapped = mapped_content_blocks[index]
          while (placeholder = empty_blocks[empty_block_index]) && placeholder[:range][:start] <= (mapped&.dig(:range, :start) || Float::INFINITY)
            append_empty_block.call(placeholder)
            empty_block_index += 1
          end
          region = mapped_regions.find { |candidate| candidate[:block_id] == mapped&.dig(:id) }
          valid_mapping = valid_editable_mapping?(mapped, region, block.markdown, editor_map[:source_length])
          classes = position_classes(block.position)
          class_names = ["document-editor-block", classes].reject(&:blank?).join(" ")
          if valid_mapping
            attributes = %( class="#{ERB::Util.html_escape(class_names)}" data-editor-region-id="#{ERB::Util.html_escape(mapped[:editable_region_id].to_s)}" data-editor-block-id="#{ERB::Util.html_escape(mapped[:id].to_s)}" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input->visual-editor#projectionInput focus->visual-editor#blockFocus blur->visual-editor#blockBlur")
          else
            attributes = %( class="#{ERB::Util.html_escape(class_names)}" contenteditable="false" aria-readonly="true")
          end
          render_source, caret_token = if valid_mapping && %w[list quote].include?(mapped[:kind])
            editable_structured_render_source(mapped[:markdown], mapped[:kind])
          else
            [block.markdown, nil]
          end
          rendered = if region&.dig(:empty_heading)
            "<h1><br></h1>"
          else
            DocumentLinks::Renderer.render(render_source, documents: documents, workspace: workspace)
          end
          rendered = editable_media(rendered, block.markdown) if valid_mapping && mapped[:kind] == "image"
          if valid_mapping && %w[list quote].include?(mapped[:kind])
            rendered = editable_trailing_structured_line(rendered, mapped[:markdown], mapped[:kind], caret_token)
          end
          html << %(<div#{attributes}>#{rendered}</div>)
        end
        while (placeholder = empty_blocks[empty_block_index])
          append_empty_block.call(placeholder)
          empty_block_index += 1
        end
        return html.html_safe
      end

      if slide.blocks.any? { |block| block.position }
        rendered = slide.blocks.map.with_index do |block, index|
          classes = position_classes(block.position)
          line = source_line_for(source, block.markdown, index)
          %(<div class="document-block #{classes}" data-source-anchor="line-#{line}" data-source-line="#{line}">#{DocumentLinks::Renderer.render(block.markdown, documents: documents, workspace: workspace)}</div>)
        end.join.html_safe
      else
        annotate_source_anchors(
          DocumentLinks::Renderer.render(slide.markdown, documents: documents, workspace: workspace),
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

    def editable_structured_render_source(markdown, kind)
      lines = markdown.to_s.split("\n")
      last_line = lines.last.to_s
      marker = if kind == "list"
        last_line.match(/\A([ \t]*(?:[-*+]|\d+[.)])[ \t]*)\z/)&.[](1)
      elsif kind == "quote"
        last_line.match(/\A([ \t]*>[ \t]*)\z/)&.[](1)
      end
      return [markdown, nil] unless marker

      token = "ELEFCARETPLACEHOLDER"
      token += "_" while markdown.include?(token)
      lines[-1] = "#{marker}#{token}"
      [lines.join("\n"), token]
    end

    def editable_trailing_structured_line(rendered, markdown, kind, caret_token = nil)
      last_line = markdown.to_s.split("\n").last.to_s
      empty_list_item = kind == "list" && last_line.match?(/\A[ \t]*(?:[-*+]|\d+[.)])[ \t]*\z/)
      empty_quote_line = kind == "quote" && last_line.match?(/\A[ \t]*>[ \t]*\z/)
      return rendered unless caret_token && (empty_list_item || empty_quote_line)

      fragment = Nokogiri::HTML.fragment(rendered)
      if empty_list_item
        last_item = fragment.css("li").reverse.find { |item| item.text.include?(caret_token) }
        return rendered unless last_item

        last_item.children.remove
        last_item.add_child("<br>")
      else
        quote_line = fragment.css("blockquote p, blockquote div").reverse.find { |line| line.text.include?(caret_token) }
        return rendered unless quote_line

        quote_line.children.remove
        quote_line.add_child("<br>")
      end

      fragment.to_html
    end
  end
end
