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
end
