require "redcarpet"
require "rouge"
require "rouge/plugins/redcarpet"
require "katex"

module Presentations
  class HtmlRenderer < Redcarpet::Render::HTML
    include Rouge::Plugins::Redcarpet

    SAFE_URL = /\A(?:https?:|mailto:|tel:|#|\/|\.\.?\/|[^:]*\z)/i

    def initialize
      super(filter_html: true, hard_wrap: false, safe_links_only: false)
    end

    def link(link, title, content)
      return content unless safe_url?(link)

      title_attribute = title.present? ? %( title="#{ERB::Util.html_escape(title)}") : ""
      %(<a href="#{ERB::Util.html_escape(link)}"#{title_attribute}>#{content}</a>)
    end

    def image(link, title, alt_text)
      return "" unless safe_url?(link)

      title_attribute = title.present? ? %( title="#{ERB::Util.html_escape(title)}") : ""
      %(<img src="#{ERB::Util.html_escape(link)}" alt="#{ERB::Util.html_escape(alt_text)}"#{title_attribute}>)
    end

    def block_code(code, language)
      lexer = Rouge::Lexer.find_fancy(language, code) || Rouge::Lexers::PlainText
      formatter = Rouge::Formatters::HTML.new
      %(<pre><code class="highlight #{ERB::Util.html_escape(lexer.tag)}">#{formatter.format(lexer.lex(code))}</code></pre>)
    end

    private

    def safe_url?(url)
      url.to_s.match?(SAFE_URL)
    end
  end

  module MarkdownRenderer
    module_function

    def render(markdown)
      html = markdown_renderer.render(markdown.to_s)
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
      Katex.render(expression, display_mode: display_mode)
    rescue StandardError
      %(<span class="math-error" title="Invalid TeX">#{ERB::Util.html_escape(expression)}</span>)
    end
  end
end
