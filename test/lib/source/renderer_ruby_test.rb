require "test_helper"

class SourceRendererRubyTest < ActiveSupport::TestCase
  test "Ruby fallback sanitizes raw HTML and applies Rouge syntax highlighting" do
    html = with_ruby_renderer do
      Source::Renderer.render("# Ruby fallback\n\n<script>alert('unsafe')</script>\n\n```ruby\nputs :safe\n```")
    end

    assert_includes html, "<h1>Ruby fallback</h1>"
    refute_includes html, "<script"
    assert_includes html, "class=\"highlight ruby\""
    assert_includes html, "puts"
    assert_predicate html, :html_safe?
  end

  test "Ruby fallback renders protected math outside code and leaves code math literal" do
    html = with_ruby_renderer do
      Source::Renderer.render("Inline \\(x^2\\).\n\n```text\n\\(x^2\\)\n```")
    end

    assert_includes html, "class=\"katex\""
    assert_includes html, %q{<code class="highlight plaintext">\(x^2\)}
  end

  test "Ruby fallback resolves attached media through the supplied resolver" do
    digest = "f" * 64
    resolved = []
    resolver = ->(key) { resolved << key; ["/media/#{key}.png", "image/png"] }

    html = with_ruby_renderer do
      Source::Renderer.render("![Diagram](elef-asset:#{digest})", media_resolver: resolver)
    end

    assert_equal [digest], resolved
    assert_includes html, %(src="/media/#{digest}.png")
    assert_includes html, "presentation-media-contain"
  end

  private

  def with_ruby_renderer
    previous_renderer = ENV["ELEF_RENDERER"]
    ENV["ELEF_RENDERER"] = "ruby"
    yield
  ensure
    if previous_renderer.nil?
      ENV.delete("ELEF_RENDERER")
    else
      ENV["ELEF_RENDERER"] = previous_renderer
    end
  end
end
