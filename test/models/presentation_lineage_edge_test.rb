require "test_helper"

class PresentationLineageEdgeTest < ActiveSupport::TestCase
  setup do
    @parent = Presentation.create!(title: "Parent Presentation", source: "# Parent")
    @child = Presentation.create!(title: "Child Presentation", source: "# Child")
  end

  test "validates valid fork types and rejects invalid ones" do
    edge = PresentationLineageEdge.new(
      parent_work: @parent,
      child_work: @child,
      fork_type: "continuation"
    )
    assert edge.valid?

    edge.fork_type = "inspiration"
    assert edge.valid?

    edge.fork_type = "unsupported"
    refute edge.valid?
    assert_includes edge.errors[:fork_type], "is not included in the list"
  end

  test "enforces child_work_id uniqueness" do
    PresentationLineageEdge.create!(
      parent_work: @parent,
      child_work: @child,
      fork_type: "continuation"
    )

    duplicate_edge = PresentationLineageEdge.new(
      parent_work: @parent,
      child_work: @child,
      fork_type: "inspiration"
    )
    refute duplicate_edge.valid?
    assert_includes duplicate_edge.errors[:child_work_id], "has already been taken"
  end

  test "enforces that parent and child works must be presentations" do
    doc = Document.create!(title: "Document", source: "# Doc")

    edge_with_doc_child = PresentationLineageEdge.new(
      parent_work: @parent,
      child_work: doc,
      fork_type: "continuation"
    )
    refute edge_with_doc_child.valid?
    assert_includes edge_with_doc_child.errors[:child_work], "must be a presentation"

    edge_with_doc_parent = PresentationLineageEdge.new(
      parent_work: doc,
      child_work: @child,
      fork_type: "continuation"
    )
    refute edge_with_doc_parent.valid?
    assert_includes edge_with_doc_parent.errors[:parent_work], "must be a presentation"
  end
end
