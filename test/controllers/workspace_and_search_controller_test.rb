require "test_helper"

class WorkspaceAndSearchControllerTest < ActionDispatch::IntegrationTest
  test "persists workspace appearance defaults" do
    patch settings_path, params: { workspace: { theme: "dark", typography: "technical" } }

    assert_redirected_to settings_path
    assert_equal ["dark", "technical"], [Workspace.default.default_theme, Workspace.default.default_typography]

    get settings_path
    assert_select "select[name='workspace[theme]'] option[selected][value='dark']"
    assert_select "select[name='workspace[typography]'] option[selected][value='technical']"
  end

  test "creates a document with generic appearance overrides" do
    post documents_path, params: { document: { title: "Styled notes", source: "# Notes", theme: "dark", typography: "technical" } }

    document = Document.find_by!(title: "Styled notes")
    assert_redirected_to edit_document_path(document)
    assert_equal ["dark", "technical"], [document.theme_override, document.typography_override]
  end

  test "search ranks document title aliases headings and body and labels presentation results" do
    target = Document.create!(title: "Search alias target", source: "# Target")
    source = Document.create!(title: "Ordinary notes", source: "# Unique heading\n\nA distinctive body phrase")
    source.update!(title: "Renamed notes")
    presentation = Presentation.create!(title: "Search deck", source: "# Search deck\n\nA distinctive body phrase")

    get search_path, params: { q: "Search alias" }, as: :json
    assert_response :success
    assert_equal target.id, response.parsed_body["results"].first["id"]
    assert_equal "document", response.parsed_body["results"].first["type"]

    get search_path, params: { q: "distinctive body phrase" }, as: :json
    results = response.parsed_body["results"]
    presentation_result = results.find { |result| result["id"] == presentation.id }
    assert_equal "Presentation", presentation_result["type_label"]
    assert presentation_result["context"].include?("distinctive")
    assert_operator presentation_result["score"], :>, 0
  end
end
