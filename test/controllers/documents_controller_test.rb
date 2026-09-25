require "test_helper"

class DocumentsControllerTest < ActionDispatch::IntegrationTest
  setup do
    Document.delete_all
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

    document.reload.update!(source: "# Media\n\n#{response.parsed_body["source"]}")
    get document_path(document)
    assert_response :success
    assert_select ".document-surface img.presentation-media[src='/documents/#{document.id}/assets/#{digest}'][alt='Pixel']"

    get media_asset_document_path(document, digest)
    assert_response :redirect
    assert_includes response.location, "/rails/active_storage/blobs/redirect/"
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
    Documents::SampleData::SAMPLES.each do |sample|
      assert_equal sample[:source], Document.find_by!(sample_id: sample[:id]).reload.source
    end

    assert_no_difference("Document.count") do
      post load_samples_documents_path
    end

    assert_equal ["Personal notes", "# Keep me"], [unrelated.reload.title, unrelated.source]
    assert_equal expected_seed_records, Document.where.not(sample_id: nil).count
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
    assert_select ".document-graph"
    assert_select ".document-graph-node", count: 3
    assert_select ".document-graph-edge[data-source-id='#{source.id}'][data-target-id='#{target.id}']"
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

  test "duplicate document titles are rejected" do
    Document.create!(title: "Existing notes", source: "# Existing")
    duplicate = Document.new(title: "Existing notes", source: "# Duplicate")

    assert_not duplicate.save
    assert_includes duplicate.errors.full_messages, "Title has already been taken"
  end

  test "renaming a document preserves incoming links through aliases" do
    target = Document.create!(title: "Old title", source: "# Old title")
    incoming = Document.create!(title: "Incoming", source: "[[Old title]]\n\n`[[Old title]]`\n\n```\n[[Old title]]\n```")

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

    assert_select "a.document-link[href='#{document_path(target)}']", text: "Preview target"
    assert_select "span.document-link.unresolved", text: "[[Missing target]]"
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

  test "presentation preview keeps the saved record untouched" do
    presentation = presentations(:one)

    post preview_presentation_path(presentation), params: {
      presentation: { title: "Draft", source: "# Draft" }, revision: 12
    }, as: :json

    assert_response :success
    assert_equal 12, response.parsed_body["revision"]
    assert_includes response.parsed_body["html"], "Draft"
    assert_equal "Demo Deck", presentation.reload.title
    assert_equal "# One\n\nBody\n---\n# Two", presentation.source
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

  test "print view renders toolbar and paginated pages for a document" do
    document = Document.create!(title: "Printable Document", source: "# Page 1\n\nContent\n\n---\n\n# Page 2\n\nMore")

    get print_document_path(document)
    assert_response :success
    assert_select ".document-print-toolbar", text: /Printable Document/
    assert_select ".document-print-toolbar button", text: "Print / Save PDF"
    assert_select ".document-surface"
  end
end
