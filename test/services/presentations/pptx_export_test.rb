require "test_helper"
require "stringio"

class PresentationsPptxExportTest < ActiveSupport::TestCase
  PIXEL_PNG = Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII=").freeze

  test "builds a deterministic Markdown model for every presentation fixture" do
    fixtures = [{ id: "presentations.yml:one", title: presentations(:one).title, source: presentations(:one).source }]
    fixtures += Presentations::SampleData::SAMPLES.map { |sample| sample.slice(:id, :title, :source) }
    fixtures += Presentations::LineageSampleData::SAMPLES.map { |sample| sample.slice(:id, :title, :source) }
    remote_image = Presentations::PptxExport::RemoteImageFetcher::Image.new(PIXEL_PNG, "image/png")

    with_remote_image_fetcher(->(_url) { remote_image }) do
      fixtures.each do |fixture|
        presentation = Presentation.new(title: fixture.fetch(:title), source: fixture.fetch(:source))
        payload = Presentations::PptxExport.new(presentation).as_json
        expected_slides = presentation.slides.length

        assert_equal expected_slides, payload[:slides].length, fixture[:id]
        assert_equal 1280, payload.dig(:presentation, :width), fixture[:id]
        assert_equal 720, payload.dig(:presentation, :height), fixture[:id]
        assert_equal presentation.theme, payload.dig(:presentation, :theme), fixture[:id]
        assert_equal presentation.typography, payload.dig(:presentation, :typography), fixture[:id]
        assert payload[:slides].all? { |slide| %w[body two-column three-column image table code statement].include?(slide[:layout]) }, fixture[:id]
        assert payload[:slides].all? { |slide| slide[:blocks].all? { |block| block[:html].is_a?(String) } }, fixture[:id]
      end
    end
  end

  test "renders public HTTPS images as embedded data and fetches each URL once" do
    source = "# Images\n\n![First](https://assets.example.org/pixel.png)\n\n![Again](https://assets.example.org/pixel.png)"
    presentation = Presentation.new(title: "Remote image", source: source)
    image = Presentations::PptxExport::RemoteImageFetcher::Image.new(PIXEL_PNG, "image/png")
    fetch_count = 0
    fetch = ->(_url) { fetch_count += 1; image }

    with_remote_image_fetcher(fetch) do
      payload = Presentations::PptxExport.new(presentation).as_json
      embedded_images = payload.dig(:slides, 0, :blocks).sum { |block| block[:html].scan("data:image/png;base64,").length }

      assert_equal 2, embedded_images
      assert_equal 1, fetch_count
    end
  end

  test "preserves positions for extracted column titles in the PPTX model" do
    presentation = Presentation.new(title: "Positioned title", source: <<~MARKDOWN)
      :::position{right top}
      # Compare

      ## Left

      One side.

      ## Right

      The other side.
    MARKDOWN

    title_position = Presentations::PptxExport.new(presentation).as_json.dig(:slides, 0, :title_position)

    assert_equal({ horizontal: "right", vertical: "top", vertical_explicit: true }, title_position)
  end

  test "fails clearly when an Elef attachment reference cannot be resolved" do
    presentation = Presentation.new(title: "Missing asset", source: "# Missing\n\n![Missing](elef-asset:#{"0" * 64})")

    error = assert_raises(Presentations::PptxExport::Error) do
      Presentations::PptxExport.new(presentation).as_json
    end

    assert_match /referenced Elef image or video is unavailable/, error.message
  end

  test "uses the mounted route prefix for Elef attachment URLs" do
    digest = Digest::SHA256.hexdigest(PIXEL_PNG)
    presentation = Presentation.create!(title: "Mounted asset", source: "# Mounted\n\n![Pixel](elef-asset:#{digest})")
    presentation.assets.attach(io: StringIO.new(PIXEL_PNG), filename: "pixel.png", content_type: "image/png")
    blob = presentation.assets.blobs.last
    blob.update!(metadata: blob.metadata.merge("elef_sha256" => digest))
    previous_root = Rails.application.config.relative_url_root
    Rails.application.config.relative_url_root = "/apps/elef/dev"

    payload = Presentations::PptxExport.new(presentation).as_json

    assert_includes payload.dig(:slides, 0, :blocks, 1, :html),
      "/apps/elef/dev/presentations/#{presentation.id}/pptx_assets/#{digest}?version=draft"
  ensure
    Rails.application.config.relative_url_root = previous_root
  end

  test "rejects unsafe remote image schemes and private host addresses" do
    fetcher = Presentations::PptxExport::RemoteImageFetcher

    assert_raises(Presentations::PptxExport::Error) { fetcher.fetch("http://127.0.0.1/private.png") }
    assert_raises(Presentations::PptxExport::Error) { fetcher.fetch("https://example.org:8443/image.png") }
    assert_raises(Presentations::PptxExport::Error) { fetcher.fetch("https://user:pass@example.org/image.png") }
    assert fetcher.send(:blocked_address?, IPAddr.new("127.0.0.1"))
    assert fetcher.send(:blocked_address?, IPAddr.new("10.1.2.3"))
    assert fetcher.send(:blocked_address?, IPAddr.new("::1"))
    assert fetcher.send(:blocked_address?, IPAddr.new("64:ff9b::7f00:1"))
    assert fetcher.send(:blocked_address?, IPAddr.new("2002:7f00:1::"))
    assert_not fetcher.send(:blocked_address?, IPAddr.new("8.8.8.8"))
  end

  private

  def with_remote_image_fetcher(fetch)
    service = Presentations::PptxExport::RemoteImageFetcher
    original = service.method(:fetch)
    service.define_singleton_method(:fetch, &fetch)
    yield
  ensure
    service.define_singleton_method(:fetch, original) if service && original
  end
end
