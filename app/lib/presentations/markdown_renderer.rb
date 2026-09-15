require "redcarpet"
require "rouge"
require "rouge/plugins/redcarpet"
require "katex"

module Presentations
  class HtmlRenderer < Redcarpet::Render::HTML
    include Rouge::Plugins::Redcarpet

    def initialize
      super(filter_html: true, hard_wrap: false, safe_links_only: false)
    end

    def block_code(code, language)
      lexer = Rouge::Lexer.find_fancy(language, code) || Rouge::Lexers::PlainText
      formatter = Rouge::Formatters::HTML.new
      %(<pre><code class="highlight #{ERB::Util.html_escape(lexer.tag)}">#{formatter.format(lexer.lex(code))}</code></pre>)
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
      html.split(/(<pre\b.*?<\/pre>)/m).map do |segment|
        segment.start_with?("<pre") ? segment : render_math(segment)
      end.join
    end

    def render_math(html)
      html = html.gsub(/\$\$(.+?)\$\$/m) { katex($1, display_mode: true) }
      html.gsub(/(?<!\$)\$(?!\s)(.+?)(?<!\s)\$(?!\$)/m) { katex($1, display_mode: false) }
    end

    def katex(expression, display_mode:)
      Katex.render(expression, display_mode: display_mode)
    rescue StandardError
      %(<span class="math-error" title="Invalid TeX">#{ERB::Util.html_escape(expression)}</span>)
    end
  end
end
