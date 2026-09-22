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
end
