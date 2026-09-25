require "redcarpet"
require "rouge"
require "rouge/plugins/redcarpet"
require "katex"
require "cgi"

module Presentations
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

  module MarkdownRenderer
    module_function

    def render(markdown, media_resolver: nil)
      renderer = media_resolver ? renderer_with_media(media_resolver) : markdown_renderer
      html = renderer.render(markdown.to_s)
      render_math_outside_code(html).html_safe
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

    def render_math_outside_code(html)
      html.split(/(<(?:pre|code)\b.*?<\/(?:pre|code)>)/m).map do |segment|
        segment.match?(/\A<(?:pre|code)\b/m) ? segment : render_math(segment)
      end.join
    end

    def render_math(html)
      html.split(/(<[^>]*>)/m).map do |segment|
        next segment if segment.start_with?("<")

        escaped_dollars = []
        text = segment.gsub(/\\\$/) do
          escaped_dollars << Regexp.last_match(0)
          "\u0000MATH_ESCAPED_DOLLAR_#{escaped_dollars.length - 1}\u0000"
        end
        text = text.gsub(/\$\$(.+?)\$\$/m) { katex($1, display_mode: true) }
        text = text.gsub(/(?<!\$)\$(?!\s)(.+?)(?<!\s)\$(?!\$)/m) { katex($1, display_mode: false) }
        text.gsub(/\u0000MATH_ESCAPED_DOLLAR_(\d+)\u0000/) { escaped_dollars[Regexp.last_match(1).to_i] }
      end.join
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
