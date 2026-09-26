require "redcarpet"
require "rouge"
require "rouge/plugins/redcarpet"
require "katex"
require "cgi"
require "securerandom"

module Source
  class HtmlRenderer < Redcarpet::Render::HTML
    include Rouge::Plugins::Redcarpet

    SAFE_URL = /\A(?:https?:|mailto:|tel:|#|\/|\.\.?\/|[^:]*\z)/i

    def initialize(media_resolver: nil)
      @media_resolver = media_resolver
      super(filter_html: true, hard_wrap: false, safe_links_only: false)
    end

    def link(link, title, content)
      return content unless safe_url?(link)

      title_attribute = title.present? ? %( title="#{ERB::Util.html_escape(title)}") : ""
      %(<a href="#{ERB::Util.html_escape(link)}"#{title_attribute}>#{content}</a>)
    end

    def image(link, title, alt_text)
      fit = title.to_s.match(/\Afit:(contain|cover)\z/)&.[](1) || "contain"
      class_name = "presentation-media presentation-media-#{fit}"
      title_attribute = alt_text.present? ? %( title="#{ERB::Util.html_escape(alt_text)}") : ""

      media = nil
      if (match = link.to_s.match(/\Aelef-asset:([0-9a-f]{64})\z/))
        media = @media_resolver&.call(match[1])
        return "" unless media
      elsif @media_resolver && !link.to_s.match?(/\A(?:https?:|\/\/|data:)/i) && (media = safe_media_resolve(link.to_s))
        # Resolved via media resolver
      elsif safe_url?(link)
        ext_title_attr = title.present? ? %( title="#{ERB::Util.html_escape(title)}") : ""
        return %(<img class="#{class_name}" src="#{ERB::Util.html_escape(link)}" alt="#{ERB::Util.html_escape(alt_text)}"#{ext_title_attr} data-editor-image-source="true" contenteditable="false">)
      else
        return ""
      end

      path, content_type = media
      escaped_path = ERB::Util.html_escape(path)
      if content_type == "video/mp4"
        return %(<video class="#{class_name}" src="#{escaped_path}" controls playsinline preload="metadata" aria-label="#{ERB::Util.html_escape(alt_text)}"></video>)
      end

      %(<img class="#{class_name}" src="#{escaped_path}" alt="#{ERB::Util.html_escape(alt_text)}"#{title_attribute} data-editor-image-source="true" contenteditable="false">)
    end

    def block_code(code, language)
      lexer = Rouge::Lexer.find_fancy(language, code) || Rouge::Lexers::PlainText
      formatter = Rouge::Formatters::HTML.new
      %(<pre><code class="highlight #{ERB::Util.html_escape(lexer.tag)}">#{formatter.format(lexer.lex(code))}</code></pre>)
    end

    private

    def safe_media_resolve(identifier)
      @media_resolver&.call(identifier)
    rescue StandardError
      nil
    end

    def safe_url?(url)
      url.to_s.match?(SAFE_URL)
    end
  end

  module Renderer
    module_function

    def render(markdown, media_resolver: nil)
      renderer = media_resolver ? renderer_with_media(media_resolver) : markdown_renderer
      source, expressions = protect_math(markdown.to_s)
      html = renderer.render(source)
      render_protected_math(html, expressions).html_safe
    end

    def markdown_renderer
      @markdown_renderer ||= Redcarpet::Markdown.new(
        HtmlRenderer.new,
        autolink: true,
        fenced_code_blocks: true,
        footnotes: false,
        lax_spacing: true,
        no_intra_emphasis: true,
        space_after_headers: true,
        strikethrough: true,
        superscript: false,
        tables: true
      )
    end

    def renderer_with_media(media_resolver)
      Redcarpet::Markdown.new(
        HtmlRenderer.new(media_resolver: media_resolver),
        autolink: true,
        fenced_code_blocks: true,
        footnotes: false,
        lax_spacing: true,
        no_intra_emphasis: true,
        space_after_headers: true,
        strikethrough: true,
        superscript: false,
        tables: true
      )
    end

    def protect_math(markdown)
      placeholders = {}
      nonce = "ELEFMATH#{SecureRandom.hex(8).upcase}X"
      protected_source = +""
      cursor = 0
      inline_code_length = nil
      fence = nil

      while cursor < markdown.length
        if inline_code_length.nil? && (cursor.zero? || markdown[cursor - 1] == "\n")
          line_end = markdown.index("\n", cursor) || markdown.length
          line = markdown[cursor...line_end]
          fence_marker = line.match(/\A {0,3}(`{3,}|~{3,})/)
          if fence || fence_marker || line.match?(/\A(?: {4}|\t)/)
            if fence_marker
              marker = fence_marker[1]
              if fence.nil?
                fence = { character: marker[0], length: marker.length }
              elsif marker[0] == fence[:character] && marker.length >= fence[:length] && line[fence_marker.end(0)..].to_s.strip.empty?
                fence = nil
              end
            end

            line_end += 1 if line_end < markdown.length
            protected_source << markdown[cursor...line_end]
            cursor = line_end
            next
          end
        end

        character = markdown[cursor]
        if inline_code_length.nil? && ["\\(", "\\["].include?(markdown[cursor, 2]) && !escaped_math_delimiter?(markdown, cursor)
          opening_delimiter = markdown[cursor, 2]
          closing_delimiter = opening_delimiter == "\\(" ? "\\)" : "\\]"
          closing = math_closing_index(markdown, cursor + opening_delimiter.length, closing_delimiter)

          if closing
            expression = markdown[(cursor + opening_delimiter.length)...closing]
            placeholder = "#{nonce}#{placeholders.length}Z"
            placeholders[placeholder] = {
              expression: expression,
              display_mode: opening_delimiter == "\\[",
              source: markdown[cursor...(closing + closing_delimiter.length)]
            }
            protected_source << placeholder
            cursor = closing + closing_delimiter.length
          else
            protected_source << markdown[cursor, 2]
            cursor += 2
          end
        elsif character == "\\" && cursor + 1 < markdown.length
          protected_source << markdown[cursor, 2]
          cursor += 2
        elsif character == "`"
          run_length = 1
          run_length += 1 while markdown[cursor + run_length] == "`"
          if inline_code_length.nil?
            inline_code_length = run_length
          elsif inline_code_length == run_length
            inline_code_length = nil
          end
          protected_source << markdown[cursor, run_length]
          cursor += run_length
        elsif inline_code_length
          protected_source << character
          cursor += 1
        elsif character == "$"
          dollar_run = 1
          dollar_run += 1 while markdown[cursor + dollar_run] == "$"
          delimiter_length = dollar_run == 1 || dollar_run == 2 ? dollar_run : 0
          delimiter = "$" * delimiter_length
          closing = delimiter_length.positive? ? math_closing_index(markdown, cursor + delimiter_length, delimiter) : nil

          if closing
            expression = markdown[(cursor + delimiter_length)...closing]
            placeholder = "#{nonce}#{placeholders.length}Z"
            placeholders[placeholder] = {
              expression: expression,
              display_mode: delimiter_length == 2,
              source: markdown[cursor...(closing + delimiter_length)]
            }
            protected_source << placeholder
            cursor = closing + delimiter_length
          else
            protected_source << markdown[cursor, [dollar_run, 2].min]
            cursor += [dollar_run, 2].min
          end
        else
          protected_source << character
          cursor += 1
        end
      end

      [protected_source, placeholders]
    end

    def render_protected_math(html, expressions)
      return html if expressions.empty?

      pattern = Regexp.union(expressions.keys)
      rendered = expressions.transform_values do |math|
        katex(math[:expression], display_mode: math[:display_mode])
      end
      code_depth = 0
      html.split(/(<[^>]*>)/m).map do |segment|
        if segment.start_with?("<")
          code_depth += 1 if segment.match?(/\A<(?:pre|code)\b/i)
          code_depth = [code_depth - 1, 0].max if segment.match?(/\A<\/(?:pre|code)\b/i)
          next segment.gsub(pattern) { |placeholder| ERB::Util.html_escape(math_source(expressions.fetch(placeholder))) }
        end

        segment.gsub(pattern) do |placeholder|
          code_depth.positive? ? ERB::Util.html_escape(math_source(expressions.fetch(placeholder))) : rendered.fetch(placeholder)
        end
      end.join
    end

    def math_source(math)
      return math[:source] if math[:source]

      delimiter = math[:display_mode] ? "$$" : "$"
      "#{delimiter}#{math[:expression]}#{delimiter}"
    end

    def math_closing_index(markdown, cursor, delimiter)
      search_from = cursor

      while (closing = markdown.index(delimiter, search_from))
        dollar_delimiter = delimiter.start_with?("$")
        delimiter_length = delimiter.length
        if !escaped_math_delimiter?(markdown, closing) &&
            (!dollar_delimiter || delimiter_length == 2 || !markdown[closing + 1..].to_s.start_with?("$")) &&
            (!dollar_delimiter || delimiter_length == 2 || markdown[closing - 1] != "$")
          expression = markdown[cursor...closing]
          valid_expression = if delimiter == "$$" || delimiter == "\\]"
            expression.strip.present?
          else
            expression.present? && !expression.include?("\n") && !expression.match?(/\A\s|\s\z/)
          end
          return closing if valid_expression
        end

        search_from = closing + delimiter_length
      end

      nil
    end

    def escaped_math_delimiter?(markdown, index)
      slash_count = 0
      cursor = index - 1
      while cursor >= 0 && markdown[cursor] == "\\"
        slash_count += 1
        cursor -= 1
      end
      slash_count.odd?
    end

    def katex(expression, display_mode:)
      expression = CGI.unescapeHTML(expression)
      annotate_editor_math(Katex.render(expression, display_mode: display_mode), expression)
    rescue StandardError
      %(<span class="math-error" data-editor-math-source="#{ERB::Util.html_escape(expression)}" contenteditable="false" title="Invalid TeX">#{ERB::Util.html_escape(expression)}</span>)
    end

    def annotate_editor_math(rendered, expression)
      source = ERB::Util.html_escape(expression)
      rendered.sub(/\A<span\b([^>]*)>/) do
        %(<span#{$1} data-editor-math-source="#{source}" contenteditable="false">)
      end
    end
  end
end
