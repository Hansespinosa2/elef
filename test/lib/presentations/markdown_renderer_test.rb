require "test_helper"

class PresentationsMarkdownRendererTest < ActiveSupport::TestCase
  test "renders standard Markdown links with safe URLs" do
    html = Presentations::MarkdownRenderer.render("[Elef](https://example.com/docs 'Documentation')")
    assert_includes html, '<a href="https://example.com/docs" title="Documentation">Elef</a>'

    html_mailto = Presentations::MarkdownRenderer.render("[Email](mailto:author@example.com)")
    assert_includes html_mailto, '<a href="mailto:author@example.com">Email</a>'

    html_anchor = Presentations::MarkdownRenderer.render("[Jump](#section-1)")
    assert_includes html_anchor, '<a href="#section-1">Jump</a>'
  end

  test "blocks unsafe URL schemes in links and renders only link text" do
    unsafe_links = [
      "[Attack](javascript:alert(document.cookie))",
      "[Attack](data:text/html,<script>alert(1)</script>)",
      "[Attack](vbscript:msgbox(1))"
    ]

    unsafe_links.each do |markdown|
      html = Presentations::MarkdownRenderer.render(markdown)
      refute_includes html, "<a"
      refute_includes html, "javascript:"
      refute_includes html, "data:text/html"
      refute_includes html, "vbscript:"
      assert_includes html, "Attack"
    end
  end

  test "renders safe images with editor source metadata" do
    html = Presentations::MarkdownRenderer.render("![Sample diagram](/images/diagram.png 'Diagram title')")
    assert_includes html, '<img class="presentation-media presentation-media-contain" src="/images/diagram.png" alt="Sample diagram" title="Diagram title" data-editor-image-source="true" contenteditable="false">'
  end

  test "strips images with unsafe URLs" do
    html = Presentations::MarkdownRenderer.render("![Attack](javascript:alert(1))")
    refute_includes html, "<img"
    refute_includes html, "javascript:"
  end

  test "resolves elef-asset image attachments with contain and cover fit" do
    digest = "a" * 64
    media_resolver = ->(key) { key == digest ? ["/rails/active_storage/blobs/sample.png", "image/png"] : nil }

    contain_html = Presentations::MarkdownRenderer.render("![Diagram](elef-asset:#{digest})", media_resolver: media_resolver)
    assert_includes contain_html, 'class="presentation-media presentation-media-contain"'
    assert_includes contain_html, 'src="/rails/active_storage/blobs/sample.png"'
    assert_includes contain_html, 'alt="Diagram"'

    cover_html = Presentations::MarkdownRenderer.render("![Photo](elef-asset:#{digest} \"fit:cover\")", media_resolver: media_resolver)
    assert_includes cover_html, 'class="presentation-media presentation-media-cover"'
  end

  test "resolves elef-asset video attachments with controls and playsinline" do
    digest = "b" * 64
    media_resolver = ->(key) { key == digest ? ["/rails/active_storage/blobs/clip.mp4", "video/mp4"] : nil }

    video_html = Presentations::MarkdownRenderer.render("![Video clip](elef-asset:#{digest})", media_resolver: media_resolver)
    assert_includes video_html, '<video class="presentation-media presentation-media-contain"'
    assert_includes video_html, 'src="/rails/active_storage/blobs/clip.mp4"'
    assert_includes video_html, 'controls playsinline preload="metadata"'
    assert_includes video_html, 'aria-label="Video clip"'
  end

  test "returns empty string when an elef-asset cannot be resolved" do
    media_resolver = ->(_key) { nil }
    html = Presentations::MarkdownRenderer.render("![Missing](elef-asset:#{'c' * 64})", media_resolver: media_resolver)
    refute_includes html, "<img"
    refute_includes html, "<video"
  end

  test "renders code blocks with syntax highlighting classes" do
    ruby_code = "```ruby\ndef hello\n  puts 'world'\nend\n```"
    html = Presentations::MarkdownRenderer.render(ruby_code)
    assert_includes html, '<pre><code class="highlight ruby">'
    assert_includes html, "hello"
  end

  test "renders inline and display math via KaTeX" do
    inline_html = Presentations::MarkdownRenderer.render("Equation: $E = mc^2$ in line.")
    assert_includes inline_html, 'class="katex"'
    assert_includes inline_html, 'data-editor-math-source="E = mc^2"'

    display_html = Presentations::MarkdownRenderer.render("$$\\sum_{i=1}^n i$$")
    assert_includes display_html, 'class="katex-display"'
    assert_includes display_html, 'data-editor-math-source="\sum_{i=1}^n i"'
  end

  test "renders parenthesized inline and bracketed display math via KaTeX" do
    inline_html = Presentations::MarkdownRenderer.render("Inline \\(\\bar{x}\\).")
    assert_includes inline_html, 'class="katex"'
    assert_includes inline_html, 'data-editor-math-source="\\bar{x}"'

    display_html = Presentations::MarkdownRenderer.render("\\[\\sum_{i=1}^n i\\]")
    assert_includes display_html, 'class="katex-display"'
    assert_includes display_html, 'data-editor-math-source="\\sum_{i=1}^n i"'
  end

  test "preserves escaped dollar signs without rendering math" do
    html = Presentations::MarkdownRenderer.render("The item costs \\$50 and the other costs \\$100.")
    refute_includes html, 'class="katex"'
    assert_includes html, "$50"
    assert_includes html, "$100"
  end

  test "leaves math syntax inside code blocks literal" do
    code_html = Presentations::MarkdownRenderer.render("`$E = mc^2$` and\n\n```\n$$x^2$$\n```")
    refute_includes code_html, 'class="katex"'
    assert_includes code_html, "$E = mc^2$"
    assert_includes code_html, "$$x^2$$"
  end

  test "rescues invalid LaTeX into a styled math error element" do
    invalid_html = Presentations::MarkdownRenderer.render("$\\invalidMacro{}$")
    assert_includes invalid_html, 'class="math-error"'
    assert_includes invalid_html, 'title="Invalid TeX"'
    assert_includes invalid_html, 'data-editor-math-source="\invalidMacro{}"'
  end
end
