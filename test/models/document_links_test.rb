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

  test "identifies titles that can round-trip through the bare link syntax" do
    assert DocumentLinks::Parser.linkable_title?("Readable title")
    refute DocumentLinks::Parser.linkable_title?("Title with ]")
    refute DocumentLinks::Parser.linkable_title?("Title with `code`")
  end

  test "renders resolved links and keeps missing links visibly unresolved" do
    target = Document.create!(title: "Target", source: "# Target")

    html = DocumentLinks::Renderer.render("[[Target]] [[Missing]] `[[Target]]`", documents: [target])

    assert_includes html, %(href="/documents/#{target.id}")
    assert_includes html, %(class="document-link unresolved")
    assert_includes html, "<code>[[Target]]</code>"
  end

  test "renders links within the source work's workspace" do
    default_target = Document.create!(title: "Shared target", source: "# Default")
    other_workspace = Workspace.create!(name: "Other workspace", slug: "other-links-#{SecureRandom.hex(6)}")
    other_target = Document.create!(workspace: other_workspace, title: "Shared target", source: "# Other")
    source = Document.create!(title: "Source", source: "[[Shared target]]")

    assert_includes source.preview_html, %(href="/documents/#{default_target.id}")
    refute_includes source.preview_html, %(href="/documents/#{other_target.id}")
  end

  test "preserves backslashes in rendered document titles" do
    title = 'A\\1'
    target = Document.create!(title: title, source: "# Target")

    html = DocumentLinks::Renderer.render("[[#{title}]]", documents: [target])

    assert_includes html, %(data-document-link-title="#{title}")
    assert_includes html, %(>#{title}</a>)
  end

  test "calculates resolved and unresolved context through aliases and document keys" do
    target = Document.create!(title: "Target", source: "# Target")
    target.document_aliases.create!(workspace: target.workspace, alias_name: "theorem")
    source = Document.create!(
      title: "Source",
      source: "[[theorem]] [[document:#{target.document_key}]] [[Missing|read this]]"
    )

    assert_equal [target], source.outgoing_documents
    assert_equal ["Missing|read this"], source.unresolved_link_tokens.map(&:title)
    assert_includes target.incoming_backlinks, source
  end

  test "builds directed edges while retaining isolated documents" do
    source = Document.create!(title: "Source", source: "# Source\n\n[[Target]] [[Missing]]")
    target = Document.create!(title: "Target", source: "# Target")
    orphan = Document.create!(title: "Orphan", source: "# Orphan")

    graph = DocumentLinks::Graph.new([source, target, orphan]).as_json

    assert_equal [source.id, target.id, orphan.id], graph[:nodes].map { |node| node[:id] }
    assert_equal [{ source: source.id, target: target.id }], graph[:edges]
  end

  test "the shared graph resolver handles aliases, stable keys, and code consistently" do
    target = Document.create!(title: "Target", source: "# Target")
    target.document_aliases.create!(workspace: target.workspace, alias_name: "theorem")
    source = Document.create!(
      title: "Source",
      source: "[[theorem]] [[document:#{target.document_key}|key]] [[Target]] `[[Inline]]`\n\n```md\n[[Fenced]]\n```"
    )

    graph = DocumentLinks::Graph.new([source, target]).as_json
    html = DocumentLinks::Renderer.render(source.source, documents: [source, target])

    assert_equal [{ source: source.id, target: target.id }], graph[:edges]
    assert_equal target.document_key, graph[:nodes].last[:document_key] || graph[:nodes].last[:documentKey]
    assert_equal 3, html.scan(%(href="/documents/#{target.id}")).length
    assert_equal 3, html.scan('class="document-link"').length
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
