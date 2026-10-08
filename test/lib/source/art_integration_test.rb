require "test_helper"

class SourceArtIntegrationTest < ActiveSupport::TestCase
  test "FIX-02 mixed recursive Peers preserve nested ordered and unordered lists" do
    source = <<~MARKDOWN
      :::art
      - Research
        1. Interview users
        2. Review competitors
           - Enterprise
           - Consumer
      - Design
        - Prototype
        - Validate
    MARKDOWN
    parsed = Source::Document.parse(source, mode: :document)
    block = parsed.slides.first.blocks.first
    fragment = Nokogiri::HTML.fragment(Source::BlockRenderer.render(
      source,
      parsed: parsed,
      documents: [],
      workspace: Workspace.default
    ))
    art = fragment.at_css("[data-elef-art-root]")
    root_list = art.at_xpath("./ul")

    assert_equal "peers", block.art[:mode]
    assert_equal "rich", block.art[:density]
    assert_equal 2, block.art[:itemCount]
    assert_equal 2, root_list.xpath("./li").length
    assert_equal 2, root_list.at_xpath("./li[1]/ol").xpath("./li").length
    assert_equal ["Enterprise", "Consumer"], root_list.xpath("./li[1]/ol/li[2]/ul/li").map(&:text)
    assert_equal ["Prototype", "Validate"], root_list.xpath("./li[2]/ul/li").map(&:text)
  end

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

  test "invalid Art syntax is consumed with the same diagnostic in Ruby and JavaScript paths" do
    source = ":::art{flow}\n- A"
    parsed = Source::Document.parse(source, mode: :document)
    preview = Source::JavascriptRenderer.editor_preview(source, kind: :document, title: "Invalid Art")

    assert_equal ["ART_INVALID_SYNTAX"], parsed.slides.first.art_diagnostics.map { |diagnostic| diagnostic[:code] }
    assert_equal ["ART_INVALID_SYNTAX"], preview[:editor_map][:art_diagnostics].map { |diagnostic| diagnostic[:code] }
    assert parsed.warnings.any? { |warning| warning.include?("syntax is invalid") }
    assert preview[:warnings].any? { |warning| warning.include?("syntax is invalid") }
    refute parsed.warnings.any? { |warning| warning.include?("Unknown or malformed presentation directive") }
    refute preview[:warnings].any? { |warning| warning.include?("Unknown or malformed presentation directive") }
    refute_includes Nokogiri::HTML.fragment(preview[:html]).text, ":::art{flow}"
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

  test "Ruby and JavaScript block maps agree at adjacent Markdown and nested directive boundaries" do
    fixtures = [
      [":::art\n- Alpha\n- Beta\n## After", ["- Alpha\n- Beta", "## After"]],
      [":::art\n- Alpha\n- Beta\n***\nAfter", ["- Alpha\n- Beta", "***", "After"]],
      [":::art\n- Item one\n  :::note\n- Item two", ["- Item one\n  :::note\n- Item two"]],
      [":::art\n- Item one\n  :::art\n- Item two", ["- Item one\n  :::art\n- Item two"]]
    ]

    fixtures.each do |source, expected_blocks|
      ruby = Source::Document.parse(source, mode: :document)
      javascript = Source::JavascriptRenderer.editor_preview(source, kind: :document, title: "Boundary parity")
      ruby_blocks = ruby.slides.first.blocks
      js_blocks = javascript[:editor_map][:slides].first[:blocks]

      assert_equal expected_blocks, ruby_blocks.map(&:markdown), source.inspect
      assert_equal ruby_blocks.map(&:markdown), js_blocks.map { |block| block[:markdown] }, source.inspect
      assert_equal ruby_blocks.map { |block| !block.art.nil? }, js_blocks.map { |block| !block[:art].nil? }, source.inspect
      assert_equal 1, ruby_blocks.count { |block| block.art }, source.inspect
    end
  end

  test "Art resolution remains unbound across a margin directive barrier in both render paths" do
    source = ":::art\n:::section{Intro}\n- A"
    ruby = Source::Document.parse(source, mode: :presentation)
    javascript = Source::JavascriptRenderer.editor_preview(source, kind: :presentation, title: "Margin barrier")

    assert_equal ["ART_NO_LIST_TARGET"], ruby.slides.first.art_diagnostics.map { |diagnostic| diagnostic[:code] }
    assert_equal ["ART_NO_LIST_TARGET"], javascript[:editor_map][:slides].first[:art_diagnostics].map { |diagnostic| diagnostic[:code] }
    assert ruby.slides.first.blocks.all? { |block| block.art.nil? }
    assert javascript[:editor_map][:slides].first[:blocks].all? { |block| block[:art].nil? }
    refute_includes javascript[:html], "data-elef-art-root"
  end

  test "indented margin directives stay in Art item content in both render paths" do
    source = ":::art\n- Item one\n  :::section{Nested}\n- Item two"
    ruby = Source::Document.parse(source, mode: :presentation)
    javascript = Source::JavascriptRenderer.editor_preview(source, kind: :presentation, title: "Nested margin")
    ruby_art = ruby.slides.first.blocks.first.art
    fragment = Nokogiri::HTML.fragment(javascript[:html])
    root = fragment.at_css("[data-elef-art-root]")

    assert_nil ruby.slides.first.section
    assert_equal "peers", ruby_art[:mode]
    assert_equal "peers", root["data-art-mode"]
    root_list = root.at_xpath("./ul")
    assert_equal ruby_art[:itemCount], root_list.xpath("./li").length
    assert_equal 2, root_list.xpath("./li").length
    assert_includes root_list.at_xpath("./li[1]").text, ":::section{Nested}"
    assert_equal "", fragment.at_css(".slide-margin-section")&.text
  end

  test "Art-looking text in a protected fence remains ordinary code" do
    parsed = Source::Document.parse("```md\n:::art\n- A\n```", mode: :document)

    assert_empty parsed.slides.first.art_diagnostics
    assert_empty parsed.warnings
    refute parsed.slides.first.blocks.any?(&:art)
    assert_includes parsed.slides.first.blocks.first.markdown, ":::art"
  end

  test "a fenced code block is a barrier for pending Art binding" do
    source = ":::art\n```js\nconst value = 1\n```\n- Later list"
    parsed = Source::Document.parse(source, mode: :document)

    assert_equal "ART_NO_LIST_TARGET", parsed.slides.first.art_diagnostics.first[:code]
    assert parsed.slides.first.blocks.none?(&:art)
    assert_includes parsed.warnings.join(" "), "root Markdown list"
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
