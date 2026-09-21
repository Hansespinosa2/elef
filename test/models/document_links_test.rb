require "test_helper"

class DocumentLinksTest < ActiveSupport::TestCase
  setup do
    Document.delete_all
  end

  test "parses links outside inline and fenced code" do
    source = "See [[Target]] and `[[Inline code]]`.\n\n    [[Indented code]]\n\n```markdown\n[[Fenced code]]\n```\n\n~~~\n[[Tilde fence]]\n~~~"

    assert_equal ["Target"], DocumentLinks::Parser.parse(source).map(&:title)
  end

  test "rewrites only exact document titles outside code" do
    source = "[[Old title]] [[Old title extended]] `[[Old title]]`\n\n```\n[[Old title]]\n```"

    assert_equal "[[New title]] [[Old title extended]] `[[Old title]]`\n\n```\n[[Old title]]\n```",
      DocumentLinks::Parser.rewrite(source, "Old title", "New title")
  end

  test "renders resolved links and keeps missing links visibly unresolved" do
    target = Document.create!(title: "Target", source: "# Target")

    html = DocumentLinks::Renderer.render("[[Target]] [[Missing]] `[[Target]]`", documents: [target])

    assert_includes html, %(href="/documents/#{target.id}")
    assert_includes html, %(class="document-link unresolved")
    assert_includes html, "<code>[[Target]]</code>"
  end

  test "builds directed edges while retaining isolated documents" do
    source = Document.create!(title: "Source", source: "# Source\n\n[[Target]] [[Missing]]")
    target = Document.create!(title: "Target", source: "# Target")
    orphan = Document.create!(title: "Orphan", source: "# Orphan")

    graph = DocumentLinks::Graph.new([source, target, orphan]).as_json

    assert_equal [source.id, target.id, orphan.id], graph[:nodes].map { |node| node[:id] }
    assert_equal [{ source: source.id, target: target.id }], graph[:edges]
  end

  test "document titles are unique without constraining presentation titles" do
    Document.create!(title: "Shared title", source: "# Notes")
    duplicate = Document.new(title: "Shared title", source: "# Other")
    presentation = Presentation.new(title: "Shared title", source: "# Deck")

    refute duplicate.valid?
    assert_includes duplicate.errors[:title], "has already been taken"
    assert presentation.valid?
  end
end
