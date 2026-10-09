require "test_helper"

class SourceRendererTest < ActiveSupport::TestCase
  test "resolves elef-asset video attachments with controls and playsinline" do
    digest = "b" * 64
    media_resolver = ->(key) { key == digest ? ["/rails/active_storage/blobs/clip.mp4", "video/mp4"] : nil }

    video_html = Source::Renderer.render("![Video clip](elef-asset:#{digest})", media_resolver: media_resolver)
    assert_includes video_html, '<video class="presentation-media presentation-media-contain"'
    assert_includes video_html, 'src="/rails/active_storage/blobs/clip.mp4"'
    assert_includes video_html, 'controls playsinline preload="metadata"'
    assert_includes video_html, 'aria-label="Video clip"'
  end

  test "returns empty string when an elef-asset cannot be resolved" do
    media_resolver = ->(_key) { nil }
    html = Source::Renderer.render("![Missing](elef-asset:#{'c' * 64})", media_resolver: media_resolver)
    refute_includes html, "<img"
    refute_includes html, "<video"
  end

  test "propagates a missing Elef asset resolver error" do
    resolver_error = IOError.new("missing Elef attachment")
    media_resolver = ->(_key) { raise resolver_error }

    error = assert_raises(IOError) do
      Source::Renderer.render("![Missing](elef-asset:#{'d' * 64})", media_resolver: media_resolver)
    end

    assert_same resolver_error, error
  end

  test "passes the media resolver through and returns HTML-safe output" do
    digest = "e" * 64
    resolved = []
    media_resolver = lambda do |key|
      resolved << key
      ["/media/#{key}.png", "image/png"]
    end

    html = Source::Renderer.render("![Diagram](elef-asset:#{digest})", media_resolver: media_resolver)

    assert_equal [digest], resolved
    assert_includes html, %(src="/media/#{digest}.png")
    assert_predicate html, :html_safe?
  end
end
