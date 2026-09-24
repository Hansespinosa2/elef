require "application_system_test_case"
require "stringio"
require "zip"

class PptxExportTest < ApplicationSystemTestCase
  PIXEL_PNG = Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII=").freeze
  EXPECTED_BACKGROUNDS = {
    "dark" => %w[#202c32 #11161a],
    "light" => %w[#fffdf8 #f5f0e7],
    "match" => %w[#fcfaf5 #f5f0e7]
  }.freeze

  test "exports every presentation fixture as a styled 16:9 PPTX" do
    fixtures = [{ id: "presentations.yml:one", presentation: presentations(:one) }]
    fixtures += (Presentations::SampleData::SAMPLES + Presentations::LineageSampleData::SAMPLES).map do |sample|
      { id: sample.fetch(:id), presentation: Presentation.create!(title: sample.fetch(:title), source: sample.fetch(:source)) }
    end
    fake_image = Presentations::PptxExport::RemoteImageFetcher::Image.new(PIXEL_PNG, "image/png")
    generated_packages = 0

    with_remote_image_fetcher(->(_url) { fake_image }) do
      fixtures.each do |fixture|
        presentation = fixture.fetch(:presentation)
        visit presentation_path(presentation)
        capture_pptx_blob
        find(".show-actions button", text: "Download PPTX").click
        assert_selector '[role="status"]', text: "PowerPoint downloaded.", wait: 30

        pptx_bytes = captured_pptx_bytes
        geometry = page.evaluate_script("window.__elefPptxExpectedHeadings")
        generated_packages += 1
        assert_pptx_visual_contract(pptx_bytes, presentation, fixture.fetch(:id), geometry)
      end
    end

    assert_equal fixtures.length, generated_packages
  end

  test "draft export includes editor changes made immediately before download" do
    presentation = Presentation.create!(title: "Unsaved export", source: "# Saved source")

    visit edit_presentation_path(presentation)
    capture_pptx_blob
    fill_in "Markdown source", with: "# Unsaved source\n\nThis edit has not autosaved yet."
    find("button", text: "Download PPTX draft").click
    assert_selector '[role="status"]', text: "PowerPoint downloaded.", wait: 15

    Zip::File.open_buffer(StringIO.new(captured_pptx_bytes)) do |archive|
      slide_text = Nokogiri::XML(archive.read("ppt/slides/slide1.xml"))
        .xpath("//a:t", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main")
        .map(&:text).join(" ")
      assert_includes slide_text, "Unsaved source"
      assert_not_includes slide_text, "Saved source"
    end
  end

  test "embeds Elef image and MP4 attachments in the generated presentation" do
    png = PIXEL_PNG
    mp4 = "fixture mp4 payload".b
    image_digest = Digest::SHA256.hexdigest(png)
    video_digest = Digest::SHA256.hexdigest(mp4)
    source = "# Media attachments\n\n![Pixel](elef-asset:#{image_digest})\n\n![Clip](elef-asset:#{video_digest})"
    presentation = Presentation.create!(title: "PPTX media", source: source)
    presentation.assets.attach(io: StringIO.new(png), filename: "pixel.png", content_type: "image/png")
    presentation.assets.attach(io: StringIO.new(mp4), filename: "clip.mp4", content_type: "video/mp4")
    presentation.assets.blobs.each do |blob|
      digest = blob.filename.to_s.end_with?(".mp4") ? video_digest : image_digest
      blob.update!(metadata: blob.metadata.merge("elef_sha256" => digest))
    end

    visit presentation_path(presentation)
    capture_pptx_blob
    find(".show-actions button", text: "Download PPTX").click
    assert_selector '[role="status"]', text: "PowerPoint downloaded.", wait: 15
    bytes = captured_pptx_bytes

    Zip::File.open_buffer(StringIO.new(bytes)) do |archive|
      media = archive.entries.map(&:name).grep(%r{\Appt/media/})
      assert media.any? { |path| path.end_with?(".mp4") }, "PPTX should contain the attached MP4"
      assert media.any? { |path| path.end_with?(".png") }, "PPTX should contain the attached PNG"
    end
  end

  test "published export button downloads the pinned release instead of the draft" do
    presentation = Presentation.create!(title: "PPTX release", source: "# Pinned release")
    PresentationReleasePublisher.call(presentation)
    presentation.update!(source: "# Current draft")

    visit edit_presentation_path(presentation)
    capture_pptx_blob
    click_button "Download published PPTX"
    assert_selector '[role="status"]', text: "PowerPoint downloaded.", wait: 15
    bytes = captured_pptx_bytes

    Zip::File.open_buffer(StringIO.new(bytes)) do |archive|
      slide = Nokogiri::XML(archive.read("ppt/slides/slide1.xml"))
      text = slide.xpath("//a:t", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main").map(&:text).join(" ")
      assert_includes text, "Pinned release"
      assert_not_includes text, "Current draft"
    end
  end

  private

  def capture_pptx_blob
    page.execute_script(<<~JAVASCRIPT)
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        window.__elefPptxBlob = blob;
        window.__elefPptxBlobType = blob.type;
        return originalCreateObjectURL(blob);
      };
      const originalRemove = Element.prototype.remove;
      Element.prototype.remove = function() {
        if (this.classList?.contains("pptx-render-stage")) {
          window.__elefPptxExpectedHeadings = [...this.querySelectorAll(".slide")].map((slide) => {
            const heading = slide.querySelector("h1,h2,h3,h4,h5,h6");
            if (!heading || heading.querySelector(".katex")) return null;
            const rootRect = slide.getBoundingClientRect();
            const headingRect = heading.getBoundingClientRect();
            return {
              text: heading.textContent.replace(/\s+/g, " ").trim(),
              x: headingRect.left - rootRect.left, y: headingRect.top - rootRect.top,
              w: headingRect.width, h: headingRect.height
            };
          });
        }
        return originalRemove.call(this);
      };
    JAVASCRIPT
  end

  def captured_pptx_bytes
    data_uri = page.driver.browser.execute_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      if (!window.__elefPptxBlob) return done(null);
      const reader = new FileReader();
      reader.onload = () => done(reader.result);
      reader.onerror = () => done(null);
      reader.readAsDataURL(window.__elefPptxBlob);
    JAVASCRIPT
    assert data_uri, "the browser did not produce a PowerPoint blob (type: #{page.evaluate_script('window.__elefPptxBlobType')})"
    Base64.decode64(data_uri.split(",", 2).last)
  end

  def assert_pptx_visual_contract(bytes, presentation, fixture_id, expected_heading_geometries)
    slide_models = presentation.slides
    title = Presentations::Document.extract_first_h1(presentation.source)
    expected_background = EXPECTED_BACKGROUNDS.fetch(presentation.theme)

    Zip::File.open_buffer(StringIO.new(bytes)) do |archive|
      entries = archive.entries.map(&:name)
      slide_paths = entries.grep(%r{\Appt/slides/slide\d+\.xml\z}).sort_by { |path| path[/\d+/].to_i }
      assert_equal slide_models.length, slide_paths.length, "#{fixture_id} slide count"

      presentation_xml = Nokogiri::XML(archive.read("ppt/presentation.xml"))
      slide_size = presentation_xml.at_xpath("//p:sldSz", "p" => "http://schemas.openxmlformats.org/presentationml/2006/main")
      assert_equal "12192000", slide_size["cx"], "#{fixture_id} slide width"
      assert_equal "6858000", slide_size["cy"], "#{fixture_id} slide height"

      all_text = []
      slide_paths.each_with_index do |path, index|
        slide_bytes = archive.read(path)
        refute_includes slide_bytes, "NaN", "#{fixture_id} #{path} must contain finite text styles"
        xml = Nokogiri::XML(slide_bytes)
        slide_text = xml.xpath("//a:t", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main").map(&:text)
        all_text.concat(slide_text)
        shape_boxes = xml.xpath("//p:sp/p:spPr/a:xfrm", {
          "p" => "http://schemas.openxmlformats.org/presentationml/2006/main",
          "a" => "http://schemas.openxmlformats.org/drawingml/2006/main"
        })
        assert_operator shape_boxes.length, :>, 0, "#{fixture_id} #{path} should contain positioned shapes"
        shape_boxes.each do |box|
          assert_operator box.at_xpath("a:ext/@cx", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main").value.to_i, :>, 0
          assert_operator box.at_xpath("a:ext/@cy", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main").value.to_i, :>, 0
        end
        if slide_models[index].layout == "table"
          assert xml.at_xpath("//p:graphicFrame", "p" => "http://schemas.openxmlformats.org/presentationml/2006/main"), "#{fixture_id} table should remain an editable PowerPoint table"
        end

        expected_heading = expected_heading_geometries[index]
        next unless expected_heading

        title_shape = xml.xpath("//p:sp", "p" => "http://schemas.openxmlformats.org/presentationml/2006/main").find do |shape|
          shape.xpath(".//a:t", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main").map(&:text).join.include?(expected_heading.fetch("text"))
        end
        refute_nil title_shape, "#{fixture_id} slide #{index + 1} heading should be a native text shape"
        assert_shape_matches_dom_geometry(title_shape, expected_heading, "#{fixture_id} slide #{index + 1}")
      end
      assert_includes all_text.join(" "), title, "#{fixture_id} first heading text"

      slide_xml = archive.read(slide_paths.first)
      first_slide_xml = Nokogiri::XML(slide_xml)
      font_faces = first_slide_xml.xpath("//a:latin/@typeface", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main").map(&:value)
      assert font_faces.any? { |face| face.present? }, "#{fixture_id} should preserve font family names"
      expected_heading_font = { "book" => "Iowan Old Style", "modern" => "Baskerville", "technical" => "ui-sans-serif" }.fetch(presentation.typography)
      assert_includes font_faces, expected_heading_font, "#{fixture_id} heading font family"
      expected_text_color = presentation.theme == "dark" ? "E9EEE9" : "252A27"
      assert_includes slide_xml, %(val="#{expected_text_color}"), "#{fixture_id} heading color"
      assert_includes slide_xml, 'sz="8400"', "#{fixture_id} 84 pt h1 sizing"
      expected_heading = expected_heading_geometries.first
      assert expected_heading, "#{fixture_id} should expose measured CSS heading geometry"
      title_shape = first_slide_xml.xpath("//p:sp", "p" => "http://schemas.openxmlformats.org/presentationml/2006/main").find do |shape|
        shape.xpath(".//a:t", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main").map(&:text).join.include?(title)
      end
      refute_nil title_shape, "#{fixture_id} first heading should be a native positioned text shape"
      assert_match(/<a:rPr[^>]*sz="8400"/, title_shape.to_xml, "#{fixture_id} heading run should use 84 pt text")
      assert_equal "95000", title_shape.at_xpath(".//a:spcPct/@val", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main").value,
        "#{fixture_id} h1 line spacing should match the CSS 0.95 value"
      assert_includes entries.grep(%r{\Appt/media/}).map { |path| File.extname(path) }, ".svg", "#{fixture_id} should use the Elef SVG slide background"

      margin = presentation.document.margin_settings
      slide_models.each_with_index do |slide, index|
        slide_text = Nokogiri::XML(archive.read(slide_paths[index])).xpath("//a:t", "a" => "http://schemas.openxmlformats.org/drawingml/2006/main").map(&:text).join(" ")
        assert_includes slide_text, "#{index + 1} / #{slide_models.length}", "#{fixture_id} slide number" if margin.slide_count
        assert_includes slide_text, slide.section.upcase, "#{fixture_id} section header" if margin.section && slide.section.present?
        assert_includes slide_text, slide.subsection.upcase, "#{fixture_id} subsection header" if margin.subsection && slide.subsection.present?
      end

      if fixture_id == "markdown-basics"
        drawing_ns = { "a" => "http://schemas.openxmlformats.org/drawingml/2006/main" }
        drawing_xml = slide_paths.map { |path| Nokogiri::XML(archive.read(path)) }
        assert drawing_xml.any? { |xml| xml.at_xpath("//a:rPr[@b='1']", drawing_ns) }, "Markdown bold should remain bold PowerPoint text"
        assert drawing_xml.any? { |xml| xml.at_xpath("//a:rPr[@i='1']", drawing_ns) }, "Markdown italics should remain italic PowerPoint text"
        assert drawing_xml.any? { |xml| xml.at_xpath("//a:rPr[@strike]", drawing_ns) }, "Markdown strikethrough should remain styled text"
        assert drawing_xml.any? { |xml| xml.at_xpath("//a:hlinkClick", drawing_ns) }, "Markdown links should remain clickable"
        assert drawing_xml.any? { |xml| xml.at_xpath("//a:buChar | //a:buAutoNum", drawing_ns) }, "Markdown lists should remain editable lists"
      elsif fixture_id == "code-and-math"
        drawing_ns = {
          "p" => "http://schemas.openxmlformats.org/presentationml/2006/main",
          "a" => "http://schemas.openxmlformats.org/drawingml/2006/main"
        }
        assert slide_paths.any? { |path| Nokogiri::XML(archive.read(path)).xpath("//p:pic", drawing_ns).length > 1 },
          "KaTeX should render to an embedded slide image"
      end

      background_svg = entries.grep(%r{\Appt/media/.*\.svg\z}).map { |path| archive.read(path).force_encoding("UTF-8") }.join
      expected_background.each { |color| assert_includes background_svg, color, "#{fixture_id} theme background #{color}" }
    end
  end

  def assert_shape_matches_dom_geometry(shape, geometry, context)
    offset = shape.at_xpath("p:spPr/a:xfrm/a:off", {
      "p" => "http://schemas.openxmlformats.org/presentationml/2006/main",
      "a" => "http://schemas.openxmlformats.org/drawingml/2006/main"
    })
    extent = shape.at_xpath("p:spPr/a:xfrm/a:ext", {
      "p" => "http://schemas.openxmlformats.org/presentationml/2006/main",
      "a" => "http://schemas.openxmlformats.org/drawingml/2006/main"
    })
    %w[x y w h].each do |axis|
      expected = (geometry.fetch(axis).to_f * 914_400 / 96).round
      actual = %w[x y].include?(axis) ? offset[axis].to_i : extent[axis == "w" ? "cx" : "cy"].to_i
      assert_in_delta expected, actual, 2, "#{context} heading #{axis} should match rendered CSS geometry"
    end
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
