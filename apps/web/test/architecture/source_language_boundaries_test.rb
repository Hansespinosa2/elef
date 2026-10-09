require "test_helper"

# Guards the dependency direction between the shared Markdown source language
# (Source::), the shared media adapter (WorkAssets), and presentation delivery
# (Presentations::).
#
# Documents and presentations are built from the same source text, so the parser,
# the renderer, and the asset adapter are shared. They used to live under
# Presentations::, which made a document change reach into a presentation
# namespace for titles, themes, media, and HTML. The checks below fail as soon as
# that coupling returns, including the "harmless" kind that only misbehaves at
# runtime in one work kind.
class SourceLanguageBoundariesTest < ActiveSupport::TestCase
  # The source language is plain text in, plain structures out. If it reaches for
  # Active Record it stops being shared and becomes a server component that a
  # future desktop core cannot reuse.
  SHARED_SOURCE_FILES = %w[
    app/lib/source/document.rb
    app/lib/source/renderer.rb
  ].freeze

  ACTIVE_RECORD_ENTRY_POINTS =
    /\b(?:ActiveRecord|ActiveStorage|::Document|::Presentation|::Workspace|::Work|belongs_to|has_many|has_one|validates)\b/

  # Nothing that only knows how to read a document may reach for presentation
  # delivery: a deck's slide chrome, lineage, releases, and PPTX export.
  DOCUMENT_SIDE_FILES = %w[
    app/models/document.rb
    app/models/work.rb
    app/controllers/documents_controller.rb
    app/lib/document_links/parser.rb
    app/lib/document_links/renderer.rb
    app/lib/document_links/graph.rb
  ].freeze

  def read(relative_path)
    Rails.root.join(relative_path).read
  end

  test "the shared source language is no longer namespaced under Presentations" do
    %w[
      Presentations::Document
      Presentations::MarkdownRenderer
      Presentations::HtmlRenderer
      Presentations::DocumentRenderer
      Presentations::MediaAssets
    ].each do |constant|
      assert_not Object.const_defined?(constant),
        "#{constant} was removed; shared code belongs in the Source:: namespace or in WorkAssets"
    end

    assert_kind_of Module, Source::Document
    assert_kind_of Module, Source::Renderer
    assert_kind_of Module, Source::BlockRenderer
    assert_kind_of Module, WorkAssets
  end

  test "the parser and renderer stay free of Active Record" do
    SHARED_SOURCE_FILES.each do |relative_path|
      offenders = read(relative_path).lines.grep(ACTIVE_RECORD_ENTRY_POINTS)

      assert_empty offenders,
        "#{relative_path} must stay database-free so both work kinds can share it:\n#{offenders.join}"
    end
  end

  test "document reading and persistence never import the Presentations namespace" do
    DOCUMENT_SIDE_FILES.each do |relative_path|
      offenders = read(relative_path).lines.grep(/Presentations::/)

      assert_empty offenders,
        "#{relative_path} must not import the Presentations:: namespace:\n#{offenders.join}"
    end
  end

  test "both kinds derive their title from the same shared source language" do
    document = Document.create!(source: "# Shared Heading\n\nBody.")
    presentation = Presentation.create!(source: "# Shared Heading\n\nBody.")

    assert_equal "Shared Heading", document.title
    assert_equal "Shared Heading", presentation.title
  end

  test "both kinds build an editor map through the same shared parser" do
    source = "# Shared Heading\n\nA **bold** line and $x^2$.\n"

    document_map = Source::Document.editor_map(source, source_name: "s", mode: :document)
    presentation_map = Source::Document.editor_map(source, source_name: "s", mode: :presentation)

    assert_equal "document", document_map[:mode]
    assert_equal "presentation", presentation_map[:mode]
    assert_equal 1, document_map[:slides].size
    assert_equal document_map[:source_length], presentation_map[:source_length]
    assert document_map[:editable_regions].any?, "the document map must expose editable regions"
    assert presentation_map[:editable_regions].any?, "the presentation map must expose editable regions"
  end

  test "both kinds render HTML through the same shared renderer" do
    html = Source::Renderer.render("# Title\n\n```ruby\nputs 1\n```\n\nand $x^2$\n")

    assert_includes html, "<h1"
    assert_includes html, "class=\"highlight"
    assert_includes html, "katex"
  end

  test "document graph resolution is provided by the Rails-owned renderer bundle" do
    graph = read("app/lib/document_links/graph.rb")
    renderer = read("app/lib/source/javascript_renderer.rb")
    bundle = read("app/javascript/lib/renderer_global.js")

    assert_includes graph, "Source::JavascriptRenderer.document_graph"
    assert_includes renderer, 'context.call("ElefRenderer.buildDocumentGraph"'
    assert_includes bundle, "buildDocumentGraph"
  end

  test "the media adapter serves both kinds from one URL scheme" do
    digest = "a" * 64
    document = Document.create!(source: "![alt](elef-asset:#{digest})")
    presentation = Presentation.create!(source: "![alt](elef-asset:#{digest})")

    assert_equal "![alt](elef-asset:#{digest} \"fit:contain\")",
      WorkAssets.markdown_source(digest, alt: "alt", fit: "contain")
    assert_equal "/documents/#{document.id}/assets/#{digest}", WorkAssets.asset_path(document, digest)
    assert_equal "/presentations/#{presentation.id}/assets/#{digest}", WorkAssets.asset_path(presentation, digest)
  end
end
