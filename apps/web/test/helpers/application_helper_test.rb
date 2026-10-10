require "test_helper"

# Every helper in ApplicationHelper chooses a route, a form scope, or a DOM id
# from the kind of work it is handed. A wrong branch sends a library card to the
# wrong editor, renames the wrong record, or renders a form that submits under
# the wrong scope key, so each one is pinned against the route helpers directly.
class ApplicationHelperTest < ActionView::TestCase
  test "labels both kinds of work" do
    document = Document.create!(title: "Helper document", source: "# Helper document")
    presentation = Presentation.create!(title: "Helper deck", source: "# Helper deck")

    assert_equal "Document", work_type_label(document)
    assert_equal "Presentation", work_type_label(presentation)
  end

  test "routes every per-work path to the matching work kind" do
    document = Document.create!(title: "Helper document", source: "# Helper document")
    presentation = Presentation.create!(title: "Helper deck", source: "# Helper deck")

    assert_equal edit_document_path(document), work_edit_path(document)
    assert_equal edit_presentation_path(presentation), work_edit_path(presentation)

    assert_equal document_path(document), work_show_path(document)
    assert_equal presentation_path(presentation), work_show_path(presentation)

    assert_equal preview_document_path(document), work_preview_path(document)
    assert_equal preview_presentation_path(presentation), work_preview_path(presentation)

    assert_equal rename_document_path(document), work_rename_path(document)
    assert_equal rename_presentation_path(presentation), work_rename_path(presentation)

    assert_equal document_path(document), work_delete_path(document)
    assert_equal presentation_path(presentation), work_delete_path(presentation)
  end

  test "routes the collection preview path by work kind" do
    assert_equal preview_documents_path, work_preview_collection_path(Document.new)
    assert_equal preview_presentations_path, work_preview_collection_path(Presentation.new)
  end

  test "routes new and start from the work type name" do
    assert_equal new_document_path, work_new_path("document")
    assert_equal new_presentation_path, work_new_path("presentation")

    assert_equal start_documents_path, work_start_path("document")
    assert_equal start_presentations_path, work_start_path("presentation")

    assert_equal new_presentation_path, work_new_path("slides")
    assert_equal start_presentations_path, work_start_path(nil)
  end

  test "scopes rename forms and dom ids by work kind" do
    document = Document.create!(title: "Scoped document", source: "# Scoped document")
    presentation = Presentation.create!(title: "Scoped deck", source: "# Scoped deck")

    assert_equal "document", work_param_key(document)
    assert_equal "presentation", work_param_key(presentation)

    assert_equal "document_#{document.id}", work_dom_id(document)
    assert_equal "presentation_#{presentation.id}", work_dom_id(presentation)
  end

  test "serves the pptx library under the request script name" do
    request.script_name = "/apps/elef"

    assert_equal "/apps/elef/vendor/pptxgen.bundle.js", pptx_library_path
  end

  test "serves the pptx library under the relative url root when the request has no script name" do
    request.script_name = ""
    Rails.application.config.relative_url_root = "/mounted/elef"

    assert_equal "/mounted/elef/vendor/pptxgen.bundle.js", pptx_library_path
  ensure
    Rails.application.config.relative_url_root = nil
  end

  test "serves the pptx library from the root when nothing is mounted" do
    request.script_name = ""

    assert_equal "/vendor/pptxgen.bundle.js", pptx_library_path
  end

  test "lists only linkable document titles for the document link palette" do
    workspace = Workspace.create!(name: "Palette workspace", slug: "palette-workspace")
    Document.create!(title: "Linkable target", source: "# Linkable target", workspace: workspace)
    Document.create!(title: "Notes", source: "# Notes", workspace: workspace)
    Document.create!(title: "Unfinished]title", source: "# Bracketed", workspace: workspace)
    Presentation.create!(title: "Deck target", source: "# Deck target", workspace: workspace)

    assert_equal ["Linkable target", "Notes"], document_link_titles(workspace: workspace)
  end

  test "falls back to the default workspace when the palette has none" do
    default = Workspace.default
    Document.create!(title: "Default target", source: "# Default target", workspace: default)
    other = Workspace.create!(name: "Other workspace", slug: "other-workspace")
    Document.create!(title: "Other target", source: "# Other target", workspace: other)

    assert_equal ["Default target"], document_link_titles(workspace: nil)
  end

  test "projects editor source title style margins and same-workspace document links" do
    workspace = Workspace.create!(name: "Projection workspace", slug: "projection-workspace")
    target = Document.create!(title: "Target notes", source: "# Target notes", workspace: workspace)
    target.document_aliases.create!(workspace: workspace, alias_name: "Former target")
    Document.create!(title: "Unfinished]title", source: "# Not linkable", workspace: workspace)
    other_workspace = Workspace.create!(name: "Other projection workspace", slug: "other-projection-workspace")
    Document.create!(title: "Private notes", source: "# Private notes", workspace: other_workspace)
    presentation = Presentation.create!(title: "Projection deck", workspace: workspace, source: <<~MARKDOWN)
      ---
      theme: dark
      typography: technical
      show-in-margin:
        section: true
        subsection: false
        footnote: true
        slideCount: false
      ---
      # Saved title
    MARKDOWN
    source_override = "# Draft title\n\nSee [[Former target]]."
    expected_projection = { html: "<p>projected</p>", editor_map: { mode: "presentation" } }
    captured = {}
    renderer = lambda do |source, **options|
      captured[:source] = source
      captured[:options] = options
      expected_projection
    end

    renderer_method = Source::JavascriptRenderer.method(:editor_preview)
    Source::JavascriptRenderer.define_singleton_method(:editor_preview, &renderer)
    begin
      projection = shared_editor_projection(presentation, source: source_override, title: "Draft title")
    ensure
      Source::JavascriptRenderer.define_singleton_method(:editor_preview, &renderer_method)
    end

    assert_same expected_projection, projection
    assert_equal source_override, captured.fetch(:source)
    options = captured.fetch(:options)
    assert_equal "presentation", options.fetch(:kind)
    assert_equal "Draft title", options.fetch(:title)
    assert_equal presentation.id, options.fetch(:deck_id)
    assert_equal({ theme: "dark", typography: "technical" }, options.fetch(:style))
    assert_equal({ section: true, subsection: false, footnote: true, slide_count: false }, options.fetch(:margin_settings))
    assert_respond_to options.fetch(:media_resolver), :call
    assert_equal true, options.fetch(:allow_remote_media)
    nodes = options.fetch(:document_nodes)
    assert_equal 1, nodes.length
    assert_equal target.id.to_s, nodes.first.fetch(:id)
    assert_equal "Target notes", nodes.first.fetch(:title)
    assert_equal target.document_key, nodes.first.fetch(:documentKey)
    assert_equal document_path(target), nodes.first.fetch(:href)
    assert_includes nodes.first.fetch(:aliases), "Former target"
    refute_includes nodes.map { |node| node.fetch(:title) }, "Unfinished]title"
    refute_includes nodes.map { |node| node.fetch(:title) }, "Private notes"
  end

  test "renames the Elef DSL snippet category and leaves every other one alone" do
    assert_equal "Elef directives", snippet_category_label("Elef DSL")
    assert_equal "Layout", snippet_category_label("Layout")
    assert_equal "Math", snippet_category_label("Math")
    assert_nil snippet_category_label(nil)
  end

end
