require "test_helper"

class EditorOperationsTest < ActiveSupport::TestCase
  test "adds, moves, and deletes slides without persisting anything" do
    source = "# One\n\nFirst\n---\n# Two\n\nSecond"

    added = Presentations::EditorOperations.add_slide(source, index: 1, markdown: "# Inserted")
    moved = Presentations::EditorOperations.move_slide(added, index: 0, to: 2)
    deleted = Presentations::EditorOperations.delete_slide(moved, index: 1)

    assert_equal "# One\n\nFirst\n---\n# Two\n\nSecond", source
    assert_includes added, "# Inserted\n---\n# Two"
    assert_match(/\A# Inserted\n---\n# Two\n\nSecond\n---\n# One\n\nFirst\z/, moved)
    assert_equal "# Inserted\n---\n# One\n\nFirst", deleted
  end

  test "edits blocks and position directives while preserving the rest of the source" do
    source = "# Slide\n\nFirst\n\nSecond"

    added = Presentations::EditorOperations.add_block(source, slide_index: 0, index: 1, markdown: "Inserted")
    moved = Presentations::EditorOperations.move_block(added, slide_index: 0, block_index: 0, to: 2)
    deleted = Presentations::EditorOperations.delete_block(moved, slide_index: 0, block_index: 1)
    positioned = Presentations::EditorOperations.set_position(source, slide_index: 0, block_index: 1, position: "center middle")
    cleared = Presentations::EditorOperations.set_position(positioned, slide_index: 0, block_index: 1, position: nil)
    compact = "# Slide\n\n:::position{left}\nBody"
    compact_positioned = Presentations::EditorOperations.set_position(compact, slide_index: 0, block_index: 1, position: "right")

    assert_equal "# Slide\n\nInserted\n\nFirst\n\nSecond", added
    assert_equal "Inserted\n\nFirst\n\n# Slide\n\nSecond", moved
    assert_equal "Inserted\n\n# Slide\n\nSecond", deleted
    assert_includes positioned, ":::position{center middle}\n\nFirst"
    assert_equal source, cleared
    assert_equal "# Slide\n\n:::position{right}\nBody", compact_positioned
  end

  test "uses UTF-16 offsets for emoji source edits" do
    source = "# 🚀 Slide\n\nBody"

    updated = Presentations::EditorOperations.add_block(source, slide_index: 0, index: 1, markdown: "Next")

    assert_equal "# 🚀 Slide\n\nNext\n\nBody", updated
  end

  test "moves slides without rewriting front matter or section spacing" do
    source = "---\npresentationTheme: dark\npresentationTypography: modern\n---\n# One\n\nFirst\n---\n# Two\n\nSecond"

    moved = Presentations::EditorOperations.move_slide(source, index: 0, to: 1)

    assert_equal "---\npresentationTheme: dark\npresentationTypography: modern\n---\n# Two\n\nSecond\n---\n# One\n\nFirst", moved
    assert_equal "dark", Presentations::Document.parse(moved).presentation_theme
    assert_equal "modern", Presentations::Document.parse(moved).presentation_typography
  end

  test "moves blocks without stripping code indentation" do
    source = "# Slide\n\n```ruby\n  first\n    nested\n```\n\nAfter"

    moved = Presentations::EditorOperations.move_block(source, slide_index: 0, block_index: 1, to: 2)

    assert_equal "# Slide\n\nAfter\n\n```ruby\n  first\n    nested\n```", moved
  end
end
