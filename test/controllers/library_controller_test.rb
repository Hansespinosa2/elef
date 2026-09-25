require "test_helper"

class LibraryControllerTest < ActionDispatch::IntegrationTest
  test "root renders the combined library at canonical paths" do
    document = Document.create!(title: "Root notes", source: "# Root notes")

    get root_path

    assert_response :success
    assert_select "h1", "Library"
    assert_select "#document_#{document.id}"
    assert_select "#presentation_#{presentations(:one).id}"
    assert_select ".document-graph", count: 0
    assert_select ".lineage-panel", count: 0
    assert_select "a.app-nav-link[href='#{root_path}']", text: "Library"
    assert_select "a.library-tab[href='#{root_path}']", text: "All"
    assert_select "a.library-tab[href='#{documents_path}']", text: "Documents"
    assert_select "a.library-tab[href='#{presentations_path}']", text: "Presentations"
    assert_select "a[href*='type=']", count: 0
  end

  test "canonical library tabs link to all, documents, and presentations collection paths" do
    get root_path
    assert_response :success
    assert_select "nav.library-tabs" do
      assert_select "a[href='#{root_path}']", text: "All"
      assert_select "a[href='#{documents_path}']", text: "Documents"
      assert_select "a[href='#{presentations_path}']", text: "Presentations"
    end

    get documents_path
    assert_response :success
    assert_select "nav.library-tabs a[href='#{documents_path}'].is-active", text: "Documents"

    get presentations_path
    assert_response :success
    assert_select "nav.library-tabs a[href='#{presentations_path}'].is-active", text: "Presentations"
  end

  test "search endpoint returns JSON results with type filtering and fallback" do
    doc = Document.create!(title: "Research Alpha", source: "# Alpha notes\n\nContent")
    pres = Presentation.create!(title: "Deck Alpha", source: "# Alpha deck\n\nContent")

    get search_path, params: { q: "Alpha" }
    assert_response :success
    body = response.parsed_body
    assert_equal "Alpha", body["query"]
    assert_equal "all", body["type"]
    result_ids = body["results"].map { |r| r["id"] }
    assert_includes result_ids, doc.id
    assert_includes result_ids, pres.id

    get search_path, params: { q: "Alpha", type: "documents" }
    assert_response :success
    docs_only = response.parsed_body["results"].map { |r| r["id"] }
    assert_includes docs_only, doc.id
    refute_includes docs_only, pres.id

    get search_path, params: { q: "Alpha", type: "invalid_type" }
    assert_response :success
    assert_equal "all", response.parsed_body["type"]

    get search_path, params: { q: "" }
    assert_response :success
    assert_empty response.parsed_body["results"]
  end
end
