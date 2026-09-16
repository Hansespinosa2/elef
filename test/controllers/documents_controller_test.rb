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

  test "document library is separate from presentation library while all includes both" do
    document = Document.create!(title: "Notes", source: "# Notes")

    get documents_path
    assert_response :success
    assert_select "h1", "Document library"
    assert_select "##{ActionView::RecordIdentifier.dom_id(document)}"
    assert_select "#presentation_#{presentations(:one).id}", count: 0

    get presentations_path, params: { type: "all" }
    assert_response :success
    assert_select "h1", "Work library"
    assert_select "#document_#{document.id}"
    assert_select "#presentation_#{presentations(:one).id}"
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
