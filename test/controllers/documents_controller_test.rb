require "test_helper"

class DocumentsControllerTest < ActionDispatch::IntegrationTest
  setup do
    Document.delete_all
  end

  test "creates, edits, previews, renames, and deletes a document" do
    assert_difference("Document.count") do
      post documents_path, params: { document: { title: "Notes", source: "# Notes" } }
    end
    document = Document.order(:id).last
    assert_redirected_to edit_document_path(document)

    patch document_path(document), params: { document: { source: "# Updated" } }, as: :json
    assert_response :ok
    assert_equal "# Updated", document.reload.source

    post preview_document_path(document), params: {
      document: { title: "Draft", source: "# Unsaved\n\n---\n\nMore" }, revision: "draft-2"
    }, as: :json
    assert_response :success
    assert_equal "draft-2", response.parsed_body["revision"]
    assert_includes response.parsed_body["html"], "<hr"
    assert_equal "# Updated", document.reload.source

    patch rename_document_path(document), params: { document: { title: "Renamed" } }
    assert_redirected_to documents_path
    assert_equal "Renamed", document.reload.title

    assert_difference("Document.count", -1) { delete document_path(document) }
    assert_redirected_to documents_path
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
    assert_match /Preview could not be rendered/, response.parsed_body["warnings"].join
    assert_equal "bad-1", response.parsed_body["revision"]
    assert_equal "# Saved", document.reload.source
  end
end
