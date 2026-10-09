require "test_helper"

class DocumentsControllerTest < ActionDispatch::IntegrationTest
  test "creates a document with generic appearance overrides" do
    post documents_path, params: { document: { title: "Ignored title", source: "# Styled notes", theme: "dark", typography: "technical" } }

    document = Document.find_by!(title: "Styled notes")
    assert_redirected_to edit_document_path(document)
    assert_equal ["dark", "technical"], [document.theme_override, document.typography_override]
  end

  setup do
    Document.delete_all
  end

  test "rename preserves the all-library view and rejects arbitrary destinations" do
    work = Document.create!(source: "# Before")
    get root_path
    assert_select "form[action='#{rename_document_path(work)}'] input[name='library_view'][value='all']"
    patch rename_document_path(work), params: { library_view: "all", document: { title: "Renamed" } }
    assert_redirected_to root_path
    patch rename_document_path(work), params: { library_view: "https://example.invalid/", document: { title: "Again" } }
    assert_redirected_to documents_path
  end

  test "creates, edits, previews, renames, and deletes a document" do
    assert_difference("Document.count") do
      post documents_path, params: { document: { title: "Separate document title", source: "# Notes" } }
    end
    document = Document.order(:id).last
    assert_redirected_to edit_document_path(document)
    assert_equal "Notes", document.title

    patch document_path(document), params: { document: { source: "# Updated" } }, as: :json
    assert_response :ok
    assert_equal "# Updated", document.reload.source
    assert_equal "Updated", document.title

    post preview_document_path(document), params: {
      document: { title: "Draft", source: "# Unsaved\n\n---\n\nMore" }, revision: "draft-2"
    }, as: :json
    assert_response :success
    assert_equal "draft-2", response.parsed_body["revision"]
    assert_includes response.parsed_body["html"], "<hr"
    assert_includes response.parsed_body["html"], "<h1>Unsaved</h1>"
    assert_equal "# Updated", document.reload.source

    patch rename_document_path(document), params: { document: { title: "Renamed" } }
    assert_redirected_to documents_path
    assert_equal "Renamed", document.reload.title
    assert_equal "# Renamed", document.source

    assert_difference("Document.count", -1) { delete document_path(document) }
    assert_redirected_to documents_path
  end

  test "new document uses an available untitled heading" do
    Document.create!(source: Document::DEFAULT_SOURCE)

    get new_document_path
    assert_response :success
    config = editor_host_config
    assert_equal "# Untitled document 2", config.fetch("source")
    assert_includes config.fetch("previewHtml"), "Untitled document 2"

    assert_difference("Document.count") do
      post documents_path, params: { document: { source: Document.available_default_source } }, as: :json
    end
    assert_response :created
  end

  test "editor projections resolve document links through the shared renderer" do
    source = Document.create!(source: "# Source notes\n\n[[Target notes]]")
    target = Document.create!(title: "Target notes", source: "# Target notes")
    draft = "# Draft notes\n\n[[Target notes|Open target]]\n\n![Diagram](/diagram.svg)"

    post preview_document_path(source), params: {
      document: { source: draft }, projection: "editor", revision: "shared-projection-1"
    }, as: :json

    assert_response :success
    payload = response.parsed_body
    assert_equal "shared-projection-1", payload["revision"]
    assert_equal "document", payload.dig("editor_map", "mode")
    assert_includes payload["html"], %(href="#{document_path(target)}")
    assert_includes payload["html"], %(data-document-link-title="Target notes")
    assert_includes payload["html"], %(src="/diagram.svg")
    assert_includes payload["html"], %(data-editor-image-source="true" contenteditable="false")
    assert_includes payload["html"], %(class="editor-media-caption")
    assert_includes payload["html"], %(contenteditable="true")
    assert_equal "# Source notes\n\n[[Target notes]]", source.reload.source

    get edit_document_path(source)

    assert_response :success
    assert_includes editor_host_config.fetch("previewHtml"), %(href="#{document_path(target)}")
  end

  test "uploads and serves image assets for documents" do
    document = Document.create!(title: "Document media", source: "# Media")
    bytes = Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII=")
    Tempfile.create(["pixel", ".png"]) do |file|
      file.binmode
      file.write(bytes)
      file.rewind
      upload = Rack::Test::UploadedFile.new(file.path, "image/png")
      post upload_asset_document_path(document), params: { file: upload, alt: "Pixel" }, headers: { "Accept" => "application/json" }
    end

    assert_response :created
    digest = Digest::SHA256.hexdigest(bytes)
    assert_equal digest, response.parsed_body["digest"]
    assert_equal "![Pixel](elef-asset:#{digest} \"fit:contain\")", response.parsed_body["source"]
    assert_equal document.reload.lock_version, response.parsed_body["lock_version"]
    assert document.assets.blobs.last.analyzed?

    document.reload.update!(source: "# Media\n\n#{response.parsed_body["source"]}")
    get document_path(document)
    assert_response :success
    assert_select ".document-surface img.presentation-media[src='/documents/#{document.id}/assets/#{digest}'][alt='Pixel']"

    get media_asset_document_path(document, digest)
    assert_response :success
    assert_equal "image/png", response.media_type
    assert_equal bytes, response.body.b
  end

  test "rejects image uploads over the 50 MB media limit" do
    document = Document.create!(title: "Oversized document media", source: "# Media")
    Tempfile.create(["huge", ".png"]) do |file|
      file.truncate(50.megabytes + 1)
      upload = Rack::Test::UploadedFile.new(file.path, "image/png")
      post upload_asset_document_path(document), params: { file: upload }, headers: { "Accept" => "application/json" }
    end

    assert_response :unprocessable_content
    assert_equal "Media files must be 50 MB or smaller.", response.parsed_body["error"]
    assert_empty document.assets.reload
  end

  test "history lists revisions newest first with their payload fields" do
    document = Document.create!(title: "History document", source: "# First")
    later = document.work_revisions.create!(
      workspace: document.workspace,
      source: "# Second",
      source_digest: WorkRevision.digest("# Second"),
      reason: "checkpoint",
      status: "checkpoint"
    )

    get history_document_path(document)

    assert_response :success
    json = response.parsed_body
    assert_equal [later.id, document.work_revisions.order(:id).first.id], json.map { |entry| entry["id"] }
    assert_equal %w[created_at id reason source source_digest status].sort, json.first.keys.sort
    assert_equal "# Second", json.first["source"]
    assert_equal WorkRevision.digest("# Second"), json.first["source_digest"]
    assert_equal "checkpoint", json.first["reason"]
    assert_equal "checkpoint", json.first["status"]
    assert json.first["created_at"].present?
  end

  test "restore reinstates a chosen revision and reports the restored draft" do
    document = Document.create!(title: "Restore document", source: "# First")
    document.update!(source: "# Second")
    original = document.work_revisions.order(:id).first

    post restore_document_path(document), params: { revision_id: original.id }

    assert_redirected_to edit_document_path(document)
    assert_equal "Revision restored.", flash[:notice]
    assert_equal "# First", document.reload.source

    document.update!(source: "# Third")
    post restore_document_path(document), params: { revision_id: original.id }, as: :json

    assert_response :ok
    assert_equal "# First", response.parsed_body["source"]
    assert_equal "saved", response.parsed_body["status"]
    assert_equal "restore", response.parsed_body.dig("latest_checkpoint", "reason")
    assert_equal "# First", document.reload.source
  end

  test "document library is separate from the combined library" do
    document = Document.create!(title: "Notes", source: "# Notes")

    get documents_path
    assert_response :success
    assert_select "h1", "Library"
    assert_select "##{ActionView::RecordIdentifier.dom_id(document)}"
    assert_select "#presentation_#{presentations(:one).id}", count: 0

    get root_path
    assert_response :success
    assert_select "h1", "Library"
    assert_select "#document_#{document.id}"
    assert_select "#presentation_#{presentations(:one).id}"
  end

  test "loads sample documents idempotently from the document library" do
    unrelated = Document.create!(title: "Personal notes", source: "# Keep me")
    expected_seed_records = Documents::SampleData::SAMPLES.length

    assert_difference("Document.count", expected_seed_records) do
      post load_samples_documents_path
    end

    assert_redirected_to documents_path
    assert_equal "Sample documents loaded.", flash[:notice]
    follow_redirect!
    graph_element = Nokogiri::HTML(response.body).at_css('[data-controller="document-graph"]')
    graph = JSON.parse(graph_element["data-document-graph-data-value"])
    assert_equal Document.count, graph.fetch("nodes").length
    assert_includes graph.fetch("nodes").map { |node| node.fetch("title") }, "Stress: Renderer kitchen sink"
    assert_includes graph.fetch("nodes").map { |node| node.fetch("title") }, "Fixture: Graph orphan"

    Documents::SampleData::SAMPLES.each do |sample|
      assert_equal sample[:source], Document.find_by!(sample_id: sample[:id]).reload.source
    end

    assert_no_difference("Document.count") do
      post load_samples_documents_path
    end

    assert_equal ["Personal notes", "# Keep me"], [unrelated.reload.title, unrelated.source]
    assert_equal expected_seed_records, Document.where.not(sample_id: nil).count

    warning_document = Document.find_by!(sample_id: "document-stress-warnings")
    get document_path(warning_document)
    assert_select '[aria-label="Markdown warnings"]', text: /directive/
    assert_select ".document-link.unresolved", text: "[[Fixture: Missing document]]"
    assert_select "a[href^='javascript:']", count: 0
  end

  test "reports a sample title collision without overwriting the existing document" do
    sample = Documents::SampleData::SAMPLES.first
    existing = Document.create!(title: sample[:title], source: "# Personal document")

    assert_difference("Document.count", Documents::SampleData::SAMPLES.length - 1) do
      post load_samples_documents_path
    end

    assert_redirected_to documents_path
    assert_equal "# Personal document", existing.reload.source
    assert_nil Document.find_by(sample_id: sample[:id])
    assert_equal Documents::SampleData::SAMPLES.length - 1, Document.where.not(sample_id: nil).count
    assert_match(/Skipped sample document with conflicting title/, flash[:alert])
    assert_includes flash[:alert], sample[:title]
    assert_equal "Sample documents loaded.", flash[:notice]
  end

  test "document library exposes its sample loader" do
    get documents_path

    assert_select "form[action='#{load_samples_documents_path}']" do
      assert_select "button", text: "Load sample documents"
    end
  end

  test "documents expose their directed network while all and presentations keep theirs separate" do
    target = Document.create!(title: "Target", source: "# Target")
    source = Document.create!(title: "Source", source: "# Source\n\n[[Target]]")
    Document.create!(title: "Orphan", source: "# Orphan")

    get documents_path
    assert_select ".document-graph-panel[data-controller='document-graph']"
    graph_element = Nokogiri::HTML(response.body).at_css('[data-controller="document-graph"]')
    graph = JSON.parse(graph_element["data-document-graph-data-value"])
    assert_equal 3, graph.fetch("nodes").length
    assert_includes graph.fetch("edges"), { "source" => source.id, "target" => target.id }
    assert_select ".lineage-panel", count: 0

    get root_path
    assert_select ".document-graph", count: 0
    assert_select ".lineage-panel", count: 0
    assert_select "#document_#{source.id}"
    assert_select "#presentation_#{presentations(:one).id}"

    get presentations_path
    assert_select ".document-graph", count: 0
    assert_select ".lineage-panel"
  end

  test "renaming a document preserves incoming links through aliases" do
    target = Document.create!(title: "Old title", source: "# Old title")
    incoming = Document.create!(title: "Incoming", source: "[[Old title]]\n\n`[[Old title]]`\n\n```\n[[Old title]]\n```")

    get documents_path
    assert_select "##{ActionView::RecordIdentifier.dom_id(target)} form[action='#{rename_document_path(target)}']" do
      assert_select 'input[name="document[title]"]'
    end

    patch rename_document_path(target), params: { document: { title: "New title" } }

    assert_redirected_to documents_path
    assert_equal "New title", target.reload.title
    assert_equal "# New title", target.source
    assert_equal "[[Old title]]\n\n`[[Old title]]`\n\n```\n[[Old title]]\n```", incoming.reload.source
    get document_path(incoming)
    assert_select "a.document-link[href='#{document_path(target)}']", text: "New title"
  end

  test "document previews link to resolved documents and mark missing links" do
    target = Document.create!(title: "Preview target", source: "# Target")
    document = Document.create!(title: "Preview source", source: "See [[Preview target]] and [[Missing target]]")

    get document_path(document)

    assert_select ".document-surface a.document-link[href='#{document_path(target)}']", text: "Preview target"
    assert_select ".document-surface span.document-link.unresolved", text: "[[Missing target]]"
  end

  test "document views expose collapsed outgoing and incoming context" do
    target = Document.create!(title: "Context target", source: "# Target")
    target.document_aliases.create!(workspace: target.workspace, alias_name: "context-alias")
    source = Document.create!(title: "Context source", source: "[[context-alias]] [[Missing target]]")

    get document_path(target)

    assert_select "details.linked-context"
    assert_select "a[href='#{document_path(source)}']", text: "Context source"
    get document_path(source)
    assert_select "a[href='#{document_path(target)}']", text: "Context target"
    assert_select ".linked-context", text: /Unresolved: Missing target/
  end

  test "previews an unsaved document without creating a record" do
    assert_no_difference("Document.count") do
      post preview_documents_path, params: {
        document: { title: "Draft notes", source: "# Draft notes\n\n---\n\nMore" }, revision: "new-1"
      }, as: :json
    end

    assert_response :success
    assert_equal "new-1", response.parsed_body["revision"]
    assert_includes response.parsed_body["html"], "<hr"
    assert_includes response.parsed_body["html"], "Draft notes"
    assert_equal "document", response.parsed_body.dig("editor_map", "mode")
    assert_equal 1, response.parsed_body.dig("editor_map", "slides").length
    assert response.parsed_body.dig("editor_map", "editable_regions").any?
  end

  test "previews an unsaved document when no revision token is supplied" do
    assert_no_difference("Document.count") do
      post preview_documents_path, params: {
        document: { title: "Revisionless draft", source: "# Revisionless draft" }
      }, as: :json
    end

    assert_response :success
    assert_equal 0, response.parsed_body["revision"]
    assert_includes response.parsed_body["html"], "Revisionless draft"
  end

  test "invalid preview returns warnings without mutating saved source" do
    document = Document.create!(title: "Safe notes", source: "# Saved")

    post preview_document_path(document), params: { source: ["not text"], revision: "bad-1" }, as: :json

    assert_response :unprocessable_content
    assert_nil response.parsed_body["html"]
    assert_nil response.parsed_body["editor_map"]
    assert_equal ["Preview could not be rendered. Check the latest Markdown edit."], response.parsed_body["warnings"]
    refute_includes response.parsed_body["warnings"].join, "Markdown source must be plain text"
    assert_equal "bad-1", response.parsed_body["revision"]
    assert_equal "# Saved", document.reload.source
  end

  test "print view renders document content and its toolbar" do
    document = Document.create!(title: "Printable Document", source: "# Page 1\n\nContent\n\n---\n\n# Page 2\n\nMore")

    get print_document_path(document)
    assert_response :success
    assert_select ".document-print-toolbar", text: /Printable Document/
    assert_select ".document-print-toolbar button", text: "Print / Save PDF"
    assert_select ".document-surface h1", text: "Page 1"
    assert_select ".document-surface h1", text: "Page 2"
  end

  private

  def editor_host_config
    host = css_select("[data-editor-view-config]").first
    assert host, "expected the shared editor host"
    JSON.parse(host["data-editor-view-config"])
  end
end
