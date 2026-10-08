require "test_helper"

class SourceArtIntegrationTest < ActiveSupport::TestCase
  test "saved document resolution and rendering use shared recursive Art semantics" do
    source = <<~MARKDOWN
      :::art
      3. Research
         - Interview users
           1. Enterprise
           2. Consumer
      4. Ship
    MARKDOWN
    parsed = Source::Document.parse(source, mode: :document)
    slide = parsed.slides.first
    block = slide.blocks.first

    assert_equal 1, slide.blocks.length
    assert_equal "sequence", block.art[:mode]
    assert_equal "rich", block.art[:density]
    assert_equal 2, block.art[:itemCount]
    assert_equal 3, block.art[:orderedStart]
    assert_empty parsed.warnings

    html = Source::BlockRenderer.render(source, parsed: parsed, documents: [], workspace: Workspace.default)
    fragment = Nokogiri::HTML.fragment(html)
    art = fragment.at_css("[data-elef-art-root]")

    assert_equal "sequence", art["data-art-mode"]
    assert_equal "rich", art["data-art-density"]
    assert_equal "ready", art["data-art-status"]
    assert_equal "3", art.at_css(".elef-art-list")["start"]
    assert_equal 2, art.css(".elef-art-list > li").length
    assert_equal 2, art.css(".elef-art-list > li ul > li ol > li").length
    refute_includes html, ":::art"
  end

  test "saved document fallback preserves unsupported media and stable diagnostics" do
    source = ":::art\n- Research\n  ![mockup](images/mockup.png)"
    parsed = Source::Document.parse(source, mode: :document)
    slide = parsed.slides.first
    html = Source::BlockRenderer.render(source, parsed: parsed, documents: [], workspace: Workspace.default)
    fragment = Nokogiri::HTML.fragment(html)
    art = fragment.at_css("[data-elef-art-root]")

    assert_equal "ART_UNSUPPORTED_CONTENT", slide.art_diagnostics.first[:code]
    assert_equal "ART_UNSUPPORTED_CONTENT", art["data-art-diagnostic"]
    assert_equal "fallback-unsupported", art["data-art-status"]
    assert_equal "plain-list", art["data-art-layout"]
    assert_equal "mockup", art.at_css("img")["alt"]
    assert_includes parsed.warnings.join(" "), "unsupported content"
  end

  test "Art composes with a block alignment and does not bind across a barrier" do
    aligned = Source::Document.parse(":::align{center}\n:::art\n- One", mode: :document)
    aligned_block = aligned.slides.first.blocks.first
    assert_equal "peers", aligned_block.art[:mode]
    assert_equal "center", aligned_block.position.horizontal

    unbound = Source::Document.parse(":::art\nA paragraph.\n\n- Later", mode: :document)
    assert_equal [nil, nil], unbound.slides.first.blocks.map(&:art)
    assert_equal "ART_NO_LIST_TARGET", unbound.slides.first.art_diagnostics.first[:code]
    assert_includes unbound.warnings.join(" "), "root Markdown list"
  end

  test "saved document blocks stop at the Art root list and retain following content" do
    source = ":::art\n- Alpha\n- Beta\n\nAfter\n\nTail"
    parsed = Source::Document.parse(source, mode: :document)

    assert_equal ["- Alpha\n- Beta", "After", "Tail"], parsed.slides.first.blocks.map(&:markdown)
    assert_equal "peers", parsed.slides.first.blocks.first.art[:mode]
    assert_nil parsed.slides.first.blocks[1].art
  end

  test "Art-looking text in a protected fence remains ordinary code" do
    parsed = Source::Document.parse("```md\n:::art\n- A\n```", mode: :document)

    assert_empty parsed.slides.first.art_diagnostics
    assert_empty parsed.warnings
    refute parsed.slides.first.blocks.any?(&:art)
    assert_includes parsed.slides.first.blocks.first.markdown, ":::art"
  end

  test "indented Art-looking text stays inside ordinary list and code content" do
    list_source = "- Parent\n  :::art\n  - Child"
    code_source = "    :::art"

    [list_source, code_source].each do |source|
      parsed = Source::Document.parse(source, mode: :document)
      html = Source::BlockRenderer.render(source, parsed: parsed, documents: [], workspace: Workspace.default)

      assert_empty parsed.slides.first.art_diagnostics
      assert_empty parsed.warnings
      refute_includes html, "data-elef-art-root"
      assert_includes Nokogiri::HTML.fragment(html).text, ":::art"
    end
  end
end
