require "test_helper"

# Same Source = Same Preview = Same Export, pinned on the web host for
# presentations. The editor preview endpoint, the saved-preview partials
# (`presentations/_slides`, shared by show/present/print) and the PPTX export
# model must agree on slide content: same slides, same blocks, same text,
# same media. Saved views render bare blocks (no editor-only chrome is ever
# emitted there); the descriptors below additionally ignore any chrome
# attributes and fold image alt captions back to the image alt, so only real
# content differences can fail the comparison.
class PresentationsPreviewParityTest < ActionDispatch::IntegrationTest
  PIXEL_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="
  PIXEL_PNG = Base64.decode64(PIXEL_B64).freeze

  SAMPLE_DIR = Rails.root.join("app/lib/presentations/samples").freeze
  SAMPLE_IDS = %w[
    markdown-basics layouts-and-themes code-and-math tables-and-media
    slide-edge-cases elef-workflow renderer-stress-test
  ].freeze

  test "saved preview carries no editor chrome" do
    presentation = Presentation.create!(
      title: "Chrome leak",
      source: "# Chrome leak\n\nEnergy $(E)$.\n\n![Alt text](https://example.test/pixel.png)"
    )

    get presentation_path(presentation)

    assert_response :success
    assert_select "[data-editor-image-source]", count: 0
    assert_select "[data-editor-math-source]", count: 0
    assert_select "[data-editor-block-id]", count: 0
    assert_select '[contenteditable="false"]', count: 0
  end

  test "saved preview block HTML equals export block HTML" do
    sources = {
      "math" => "# Math title\n\nEnergy $(E = mc^2)$.\n\n$$\\sum_{i=1}^n i$$\n",
      "table" => "# Table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
      "code" => "# Code\n\n```ruby\nputs 1\n```\n",
      "image" => "# Image\n\n![Alt text](https://example.test/pixel.png)\n",
      "art" => "# Art\n\n:::art\n- Alpha\n- Beta\n"
    }
    SAMPLE_IDS.each do |id|
      sources["sample:#{id}"] = File.read(SAMPLE_DIR.join("#{id}.md"))
    end

    with_stubbed_remote_images do
      sources.each do |name, source|
        presentation = Presentation.new(title: name, source: source, work_type: "presentation")
        show_blocks = show_block_html(presentation)
        export_blocks = export_block_html(presentation)

        assert_equal export_blocks.length, show_blocks.length, "#{name}: block count"
        show_blocks.zip(export_blocks).each_with_index do |(show, expected), index|
          assert_equal normalize(expected), normalize(show), "#{name} block #{index}"
        end
      end
    end
  end

  test "editor preview, saved preview and export agree on slide content" do
    with_stubbed_remote_images do
      SAMPLE_IDS.each do |id|
        source = File.read(SAMPLE_DIR.join("#{id}.md"))
        preview_slides = preview_content(id, source)
        presentation = Presentation.new(title: id, source: source, work_type: "presentation")
        show_slides = show_content(presentation)

        assert_equal show_slides.length, preview_slides.length, "#{id}: slide count"
        preview_slides.zip(show_slides).each_with_index do |(preview, show), index|
          assert_equal show, preview, "#{id} slide #{index} content"
        end

        export_slides = export_content(presentation)
        content_slides = show_slides.map { |blocks| blocks.map { |block| block.except("classes") } }
        assert_equal content_slides.length, export_slides.length, "#{id}: export slide count"
        content_slides.zip(export_slides).each_with_index do |(show, exported), index|
          assert_equal show, exported, "#{id} slide #{index} export content"
        end
      end

      # No committed sample exercises the art pipeline, so pin the Art
      # directive through all three paths explicitly: the editor preview,
      # the saved preview and the export must agree on its content.
      art_source = "# Art\n\n:::art\n- Alpha\n- Beta\n"
      art_preview = preview_content("art", art_source)
      art_presentation = Presentation.new(title: "art", source: art_source, work_type: "presentation")
      art_show = show_content(art_presentation)

      assert_equal art_show.length, art_preview.length, "art: slide count"
      art_preview.zip(art_show).each_with_index do |(preview, show), index|
        assert_equal show, preview, "art slide #{index} content"
      end

      art_export = export_content(art_presentation)
      art_content = art_show.map { |blocks| blocks.map { |block| block.except("classes") } }
      assert_equal art_content.length, art_export.length, "art: export slide count"
      art_content.zip(art_export).each_with_index do |(show, exported), index|
        assert_equal show, exported, "art slide #{index} export content"
      end
    end
  end

  private

  def preview_content(title, source)
    post preview_presentations_path, params: {
      presentation: { title: title, source: source }
    }, as: :json
    assert_response :success
    content_slides(response.parsed_body["html"])
  end

  def show_content(presentation)
    html = PresentationsController.renderer.render(
      partial: "slides",
      locals: { presentation: presentation }
    )
    content_slides(html)
  end

  def show_block_html(presentation)
    fragment = Nokogiri::HTML5.fragment(
      PresentationsController.renderer.render(partial: "slides", locals: { presentation: presentation })
    )
    fragment.css(".slide").flat_map do |slide|
      blocks = slide.css(".slide-block").map(&:inner_html).reject(&:blank?)
      title = slide.at_css(".slide-title")&.inner_html
      if title.present? && (title_index = blocks.index(title))
        [title] + blocks.first(title_index) + blocks.drop(title_index + 1)
      else
        blocks
      end
    end
  end

  # Mirrors the export stage (packages/client pptx.ts slideMarkup): titled
  # slides render title_html plus regions, untitled slides render blocks.
  def export_block_html(presentation)
    payload = Presentations::PptxExport.new(presentation).as_json
    payload.fetch(:slides).flat_map do |slide|
      title = slide[:title_html].to_s
      if title.present?
        regions = slide.fetch(:regions).flatten(1).map { |block| block.fetch(:html).to_s }
        ([title] + regions).reject(&:blank?)
      else
        slide.fetch(:blocks).map { |block| block.fetch(:html).to_s }.reject(&:blank?)
      end
    end
  end

  def export_content(presentation)
    payload = Presentations::PptxExport.new(presentation).as_json
    payload.fetch(:slides).map do |slide|
      title = slide[:title_html].to_s
      blocks = if title.present?
        slide.fetch(:regions).flatten(1)
      else
        slide.fetch(:blocks)
      end
      (title.present? ? [descriptor_for_html(title)] : []) + blocks.map do |block|
        descriptor_for_html(block.fetch(:html).to_s)
      end.reject { |descriptor| descriptor["text"].blank? && descriptor["media"].empty? }
    end
  end

  def descriptor_for_html(html)
    fragment = Nokogiri::HTML5.fragment(html.to_s)
    {
      "text" => fragment.text.strip.gsub(/\s+/, " "),
      "media" => fragment.css("img").map { |img| [img["alt"].to_s, img["src"].present?] }
    }
  end

  # Content descriptors per slide: block classes, visible text and media.
  # Editor-only chrome is normalized away: toolbars and alignment controls
  # are dropped, empty editable placeholders are dropped (they are click
  # targets for blank source regions, rendered only while editing), image
  # alt captions are folded back to the image alt, and every data-editor-*
  # attribute is ignored.
  def content_slides(html)
    Nokogiri::HTML5.fragment(html.to_s).css(".slide").map do |slide|
      slide.css(".slide-block").filter_map do |block|
        next if block["class"].to_s.split.include?("slide-empty-block")

        media = block.css("img").map { |img| [img["alt"].to_s, img["src"].present?] }
        text = block.css("figcaption").empty? ? block.text : block_text_without_captions(block)
        {
          "classes" => block["class"].to_s.split.sort,
          "text" => text.strip.gsub(/\s+/, " "),
          "media" => media
        }
      end
    end
  end

  def block_text_without_captions(block)
    clone = block.dup
    clone.css("figcaption").remove
    clone.text
  end

  # Byte comparison modulo media resolution: the saved preview links
  # remote media by URL while the export inlines it (data URI) or rewrites
  # local assets to PPTX paths, so sources are compared with a placeholder.
  # Editor chrome attributes are NOT normalized: read-only views must render
  # the same bare blocks the export model carries.
  def normalize(html)
    fragment = Nokogiri::HTML5.fragment(html.to_s)
    fragment.xpath(".//text()").each { |node| node.remove if node.text.strip.empty? }
    fragment.css("img[src], video[src]").each { |node| node["src"] = "media" }
    fragment.to_html
  end

  def with_stubbed_remote_images
    image = Presentations::PptxExport::RemoteImageFetcher::Image.new(PIXEL_PNG, "image/png")
    service = Presentations::PptxExport::RemoteImageFetcher
    original = service.method(:fetch)
    service.define_singleton_method(:fetch) { |*_args| image }
    yield
  ensure
    service.define_singleton_method(:fetch, original) if service && original
  end
end
