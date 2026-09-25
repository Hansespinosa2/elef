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
end
