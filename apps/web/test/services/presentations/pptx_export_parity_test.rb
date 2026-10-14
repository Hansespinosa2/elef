require "test_helper"
require "stringio"
require_relative "../../../../../tooling/export_parity_baselines"

# Web side of the export-parity proof: the server output must equal the
# committed baselines the desktop builder also matches (see
# packages/client/test/export-parity.test.ts). A green pair means both
# hosts feed the shared engine identical model bytes. Regenerate the
# baselines from the server only; see tooling/export_parity_baselines.rb.
class PresentationsPptxExportParityTest < ActiveSupport::TestCase
  PIXEL_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="
  PIXEL_PNG = Base64.decode64(PIXEL_B64).freeze

  test "server model equals the committed baselines for every byte-parity fixture" do
    ExportParityBaselines::FIXTURE_IDS.each do |id|
      fixture = JSON.parse(File.read(ExportParityBaselines.parity_dir.join("#{id}.fixture.json")))
      presentation = Presentation.new(title: fixture.fetch("title"), source: fixture.fetch("source"))
      payload = Presentations::PptxExport.new(presentation).as_json
      expected = File.read(ExportParityBaselines.parity_dir.join("#{id}.expected.json"), encoding: Encoding::UTF_8)

      assert_equal expected, JSON.generate(ExportParityBaselines.canonical(payload)), id
    end
  end

  test "server inlines remote images the desktop keeps as URLs" do
    fixture = JSON.parse(File.read(ExportParityBaselines.parity_dir.join("remote-image.fixture.json")))
    image = Presentations::PptxExport::RemoteImageFetcher::Image.new(PIXEL_PNG, "image/png")

    with_remote_image_fetcher(->(_url) { image }) do
      presentation = Presentation.new(title: fixture.fetch("title"), source: fixture.fetch("source"))
      html = model_html(Presentations::PptxExport.new(presentation).as_json)

      assert_includes html, "data:image/png;base64,#{PIXEL_B64}"
      assert_not_includes html, "https://assets.example.org/pixel.png"
    end
  end

  test "server resolves local assets to pptx asset paths keyed by digest" do
    fixture = JSON.parse(File.read(ExportParityBaselines.parity_dir.join("local-image.fixture.json")))
    digest = Digest::SHA256.hexdigest(PIXEL_PNG)

    assert_includes fixture.fetch("source"), "elef-asset:#{digest}"

    presentation = Presentation.create!(title: fixture.fetch("title"), source: fixture.fetch("source"))
    presentation.assets.attach(io: StringIO.new(PIXEL_PNG), filename: "pixel.png", content_type: "image/png")
    blob = presentation.assets.blobs.last
    blob.update!(metadata: blob.metadata.merge("elef_sha256" => digest))
    html = model_html(Presentations::PptxExport.new(presentation).as_json)

    assert_includes html, "/presentations/#{presentation.id}/pptx_assets/#{digest}?version=draft"
  end

  private

  def model_html(payload)
    payload.fetch(:slides).flat_map do |slide|
      slide.fetch(:blocks) + slide.fetch(:regions).flatten(1)
    end.map { |block| block.fetch(:html) }.join("\n")
  end

  def with_remote_image_fetcher(fetch)
    service = Presentations::PptxExport::RemoteImageFetcher
    original = service.method(:fetch)
    service.define_singleton_method(:fetch, &fetch)
    yield
  ensure
    service.define_singleton_method(:fetch, original) if service && original
  end
end
