require "test_helper"

class WorkTest < ActiveSupport::TestCase
  test "uses the presentation work type by default and validates subclass types" do
    assert_equal "presentation", Presentation.new.work_type
    assert_equal "document", Document.new.work_type
    assert_equal "Notes", Document.create!(source: "# Notes").title
    assert Presentation.new(title: "Deck", source: "# Deck").valid?
    refute Presentation.new(title: "Wrong", source: "# Wrong", work_type: "document").valid?
    refute Document.new(title: "Wrong", source: "# Wrong", work_type: "presentation").valid?
  end

  test "updates a document title when its first heading changes" do
    document = Document.create!(source: "# First title\n\nBody")

    document.update!(source: "# Updated title\n\nBody")

    assert_equal "Updated title", document.title
  end

  test "preserves the exact first heading as a new document title" do
    document = Document.create!(source: "# Notes: one\n\nBody")

    assert_equal "Notes: one", document.title
  end

  test "documents stay continuous while presentations split standalone separators" do
    source = "# Notes\n\nFirst\n\n---\n\nSecond"

    document = Document.new(title: "Notes", source: source)
    presentation = Presentation.new(title: "Deck", source: source)

    assert_equal 1, document.slides.length
    assert_includes document.preview_html, "<hr"
    assert_equal 2, presentation.slides.length
    assert_equal :document, document.parsed_document.mode
    assert_equal :presentation, presentation.parsed_document.mode
  end

  test "documents render position directives without exposing the directive" do
    document = Document.new(
      title: "Positioned notes",
      source: ":::align{middle center}\n\nA centered note."
    )

    assert_includes document.preview_html, "document-block position-center position-middle"
    refute_includes document.preview_html, ":::align"
    assert_empty document.preview_warnings
  end

  test "document horizontal positioning does not create a vertical stage" do
    inline = Document.new(title: "Inline position", source: ":::align{left}\n\nA short note.")
    staged = Document.new(title: "Staged position", source: ":::align{middle center}\n\nA staged note.")

    refute_includes inline.preview_html, "position-vertical"
    assert_includes staged.preview_html, "position-vertical"
  end

  test "document previews retain the full source for shared A4 pagination" do
    document = Document.create!(
      title: "Budgeted preview",
      source: "# Budgeted preview\n\nOne.\n\nTwo.\n\nThree.\n\nFour."
    )

    html = document.preview_html

    %w[Budgeted One Two Three Four].each { |text| assert_includes html, text }
  end
end
