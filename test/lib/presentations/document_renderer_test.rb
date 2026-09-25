require "test_helper"

class PresentationsDocumentRendererTest < ActiveSupport::TestCase
  test "keeps document blocks without valid source regions non-editable" do
    source = "# Heading\n\nBody"
    editor_map = Presentations::Document.editor_map(source, mode: :document)
    editor_map[:slides].first[:editable_regions].reject! do |region|
      region[:block_id] == editor_map[:slides].first[:blocks].second[:id]
    end

    html = Presentations::DocumentRenderer.render(
      source,
      editable: true,
      editor_map: editor_map,
      documents: [],
      workspace: Workspace.default
    )
    blocks = Nokogiri::HTML.fragment(html).css(".document-editor-block")
    unmapped = blocks.find { |block| block.text.strip == "Body" }

    assert_equal 2, blocks.length
    assert_equal "true", blocks.first["contenteditable"]
    assert unmapped
    assert_equal "false", unmapped["contenteditable"]
    assert_equal "true", unmapped["aria-readonly"]
    assert_nil unmapped["data-editor-block-id"]
    assert_nil unmapped["data-action"]
  end

  test "keeps an empty first heading editable and maps a trailing blank paragraph" do
    empty_title_source = "# "
    empty_title_map = Presentations::Document.editor_map(empty_title_source, mode: :document)
    empty_title_region = empty_title_map[:editable_regions].first
    empty_title_html = Presentations::DocumentRenderer.render(
      empty_title_source,
      editable: true,
      editor_map: empty_title_map,
      documents: [],
      workspace: Workspace.default
    )

    assert_equal "title", empty_title_region[:role]
    assert_equal empty_title_region[:content_range][:start], empty_title_region[:content_range][:end]
    assert_includes empty_title_html, "<h1><br></h1>"

    trailing_blank_map = Presentations::Document.editor_map("# Heading\n\n", mode: :document)
    trailing_blank_html = Presentations::DocumentRenderer.render(
      "# Heading\n\n",
      editable: true,
      editor_map: trailing_blank_map,
      documents: [],
      workspace: Workspace.default
    )

    assert trailing_blank_map[:slides].first[:blocks].last[:empty_placeholder]
    assert_includes trailing_blank_html, 'data-editor-empty-block="true"'

    internal_blank_source = "# Heading\n\n\n\nBody"
    internal_blank_map = Presentations::Document.editor_map(internal_blank_source, mode: :document)
    internal_blank_html = Presentations::DocumentRenderer.render(
      internal_blank_source,
      editable: true,
      editor_map: internal_blank_map,
      documents: [],
      workspace: Workspace.default
    )
    internal_blocks = Nokogiri::HTML.fragment(internal_blank_html).css(".document-editor-block")

    block_ids = internal_blocks.map { |block| block["data-editor-block-id"] }
    assert_equal ["slide-1-block-1", "slide-1-empty-1", "slide-1-block-2"], block_ids
  end

  test "renders empty trailing list and quote lines as editable caret targets" do
    list_source = "# Heading\n\n- First item\n- "
    list_map = Presentations::Document.editor_map(list_source, mode: :document)
    list_html = Presentations::DocumentRenderer.render(
      list_source,
      editable: true,
      editor_map: list_map,
      documents: [],
      workspace: Workspace.default
    )
    list_items = Nokogiri::HTML.fragment(list_html).css(".document-editor-block ul > li")

    assert_equal 2, list_items.length, list_html
    assert_equal ["br"], list_items.last.element_children.map(&:name)

    quote_source = "# Heading\n\n> First line\n> "
    quote_map = Presentations::Document.editor_map(quote_source, mode: :document)
    quote_html = Presentations::DocumentRenderer.render(
      quote_source,
      editable: true,
      editor_map: quote_map,
      documents: [],
      workspace: Workspace.default
    )
    quote_lines = Nokogiri::HTML.fragment(quote_html).css(".document-editor-block blockquote > p")

    assert_equal 2, quote_lines.length, quote_html
    assert_equal ["br"], quote_lines.last.element_children.map(&:name)
  end

  test "annotates non-editable document blocks with source line anchors" do
    source = "---\ntheme: dark\n---\n# Title\n\nParagraph content.\n\n- List item"
    html = Presentations::DocumentRenderer.render(
      source,
      editable: false,
      documents: [],
      workspace: Workspace.default
    )

    fragment = Nokogiri::HTML.fragment(html)
    anchors = fragment.css(".document-source-anchor")
    assert_operator anchors.length, :>=, 3
    assert anchors.all? { |a| a["data-source-anchor"].start_with?("line-") }
    assert anchors.all? { |a| a["data-source-line"].to_i >= 4 } # front matter is lines 1-3
  end

  test "calculates position classes for positioned blocks" do
    Position = Struct.new(:horizontal, :vertical, :vertical_explicit)

    pos_default = Position.new("center", "top", false)
    assert_equal "position-center position-top", Presentations::DocumentRenderer.position_classes(pos_default)

    pos_staged = Position.new("center", "middle", true)
    assert_equal "position-center position-middle position-vertical", Presentations::DocumentRenderer.position_classes(pos_staged)

    assert_equal "", Presentations::DocumentRenderer.position_classes(nil)
  end

  test "validates editable mapping boundary conditions" do
    renderer = Presentations::DocumentRenderer
    region = { id: 1, block_id: "b1", editable: true, content_range: { start: 0, end: 10 } }
    mapped = { id: "b1", markdown: "hello", editable_region_id: 1 }

    assert renderer.valid_editable_mapping?(mapped, region, "hello", 15)

    # Markdown mismatch
    refute renderer.valid_editable_mapping?(mapped, region, "different", 15)

    # Region not editable
    refute renderer.valid_editable_mapping?(mapped, region.merge(editable: false), "hello", 15)

    # Mismatched ids
    refute renderer.valid_editable_mapping?(mapped.merge(editable_region_id: 2), region, "hello", 15)
    refute renderer.valid_editable_mapping?(mapped, region.merge(block_id: "b2"), "hello", 15)

    # Out of bounds range
    refute renderer.valid_editable_mapping?(mapped, region.merge(content_range: { start: 5, end: 20 }), "hello", 15)

    # Inverted range
    refute renderer.valid_editable_mapping?(mapped, region.merge(content_range: { start: 10, end: 5 }), "hello", 15)

    # Negative start
    refute renderer.valid_editable_mapping?(mapped, region.merge(content_range: { start: -1, end: 5 }), "hello", 15)
  end

  test "wraps editable media in figure and caption" do
    rendered = '<img src="/pic.png" alt="Alt text">'
    markdown = '![Alt text](/pic.png)'
    html = Presentations::DocumentRenderer.editable_media(rendered, markdown)

    assert_includes html, '<figure class="editor-media">'
    assert_includes html, '<figcaption class="editor-media-caption" aria-label="Editable image alt text" title="Edit image alt text">Alt text</figcaption>'
  end
end
