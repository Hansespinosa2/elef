require "test_helper"

class PresentationRevealsBaselineTest < ActiveSupport::TestCase
  BASELINE_PATH = Rails.root.join("test/javascript/fixtures/slide-reveals-no-step-baseline.json")

  test "an unchanged reveal deck gets explicit position defaults and retains its editor map" do
    baseline = JSON.parse(File.read(BASELINE_PATH), symbolize_names: true)
    document = Source::Document.parse(baseline.fetch(:source), source_name: "Reveal baseline", mode: :presentation)
    presentation = Struct.new(:id, :slides).new(nil, document.slides)
    html = ApplicationController.renderer.render(
      partial: "presentations/slide",
      locals: {
        slide: document.slides.first,
        presentation: presentation,
        presentation_slide: true,
        margin_settings: document.margin_settings
      }
    )

    fragment = Nokogiri::HTML5.fragment(html)
    assert_equal ["Baseline visual contract"], fragment.css(".slide-title h1").map { |node| node.text.strip }
    assert_equal %w[slide-title slide-block position-left position-top], fragment.at_css(".slide-title")["class"].split
    blocks = fragment.css(".slide-block")
    assert_equal 5, blocks.length
    assert blocks.all? { |block| block.classes.include?("position-left") && block.classes.include?("position-top") }
    assert_equal ["Left", "A paragraph with formatting.", "Right", "first", "second"],
      fragment.css(".slide-region .slide-block").flat_map { |block| block.css("h2,p,li").map { |node| node.text.strip } }
    assert_equal baseline.fetch(:editor_map), Source::Document.editor_map(
      baseline.fetch(:source),
      source_name: "Reveal baseline",
      mode: :presentation
    )
  end

  test "Rails Present annotates stepped title, column, and media wrappers by block identity" do
    source = <<~MARKDOWN.chomp
      :::step
      # A stepped title

      ## First column
      :::step{01}
      Same repeated content

      ## Second column
      :::step{1}
      Same repeated content

      :::step{2}
      ![Artwork](https://example.test/art.png)
    MARKDOWN
    document = Source::Document.parse(source, source_name: "Reveal render", mode: :presentation)
    presentation = Struct.new(:id, :slides).new(nil, document.slides)
    html = ApplicationController.renderer.render(
      partial: "presentations/slide",
      locals: {
        slide: document.slides.first,
        presentation: presentation,
        presentation_slide: true,
        margin_settings: document.margin_settings
      }
    )
    fragment = Nokogiri::HTML5.fragment(html)

    assert_equal "3", fragment.at_css(".slide")[:"data-elef-reveal-event-count"]
    assert_equal "0", fragment.at_css(".slide-title")[:"data-elef-reveal-event"]
    repeated = fragment.css(".slide-region .slide-block").select { |block| block.text.include?("Same repeated content") }
    assert_equal ["1", "1"], repeated.map { |block| block[:"data-elef-reveal-event"] }
    assert_equal "2", fragment.css(".slide-block").find { |block| block.at_css("img") }[:"data-elef-reveal-event"]
  end

  test "Rails Present annotates SmartArt on its complete stepped wrapper" do
    source = "# Art\n\n:::step\n:::art\n- Research\n  - Read\n- Design"
    document = Source::Document.parse(source, source_name: "Reveal Art", mode: :presentation)
    presentation = Struct.new(:id, :slides).new(nil, document.slides)
    html = ApplicationController.renderer.render(
      partial: "presentations/slide",
      locals: {
        slide: document.slides.first,
        presentation: presentation,
        presentation_slide: true,
        margin_settings: document.margin_settings
      }
    )
    fragment = Nokogiri::HTML5.fragment(html)
    block = fragment.at_css('.slide-block[data-elef-reveal-event="0"]')

    assert_equal "1", fragment.at_css(".slide")["data-elef-reveal-event-count"]
    assert block
    assert block.at_css(".elef-art")
    assert block.at_css(".elef-art-list")
  end

  test "Rails Present keeps nested literal colons visible on a no-step deck" do
    baseline = JSON.parse(File.read(Rails.root.join("test/javascript/fixtures/slide-reveals-nested-colon-baseline.json")))
    assert_equal baseline.fetch("editor_map"), Source::Document.editor_map(
      baseline.fetch("source"),
      source_name: "Untitled",
      mode: :presentation
    ).deep_stringify_keys

    document = Source::Document.parse(baseline.fetch("source"), source_name: "Nested colon baseline", mode: :presentation)
    slide = document.slides.first
    assert_equal ["# Literal colons", "- parent\n  :::\n  keep this line"], slide.blocks.map(&:markdown)
    assert_equal 0, slide.reveal_event_count
    assert_empty document.warnings

    presentation = Struct.new(:id, :slides).new(nil, document.slides)
    html = ApplicationController.renderer.render(
      partial: "presentations/slide",
      locals: {
        slide: slide,
        presentation: presentation,
        presentation_slide: true,
        margin_settings: document.margin_settings
      }
    )
    fragment = Nokogiri::HTML5.fragment(html)
    list = fragment.at_css(".slide-block ul")

    assert_equal "parent ::: keep this line", list.text.squish
    assert_nil fragment.at_css("[data-elef-reveal-event]")
  end

  private

  def normalize_template_markers(html)
    html.sub(/\A<!-- BEGIN [^\n]+\n-->\n?/, "")
      .sub(/\n<!-- END [^>]+ -->\z/, "")
      .gsub(/^[ \t]*\n/, "")
      .delete_suffix("\n")
  end
end
