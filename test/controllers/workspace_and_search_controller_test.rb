require "test_helper"

class WorkspaceAndSearchControllerTest < ActionDispatch::IntegrationTest
  test "persists workspace appearance defaults" do
    patch settings_path, params: { workspace: { theme: "dark", typography: "technical" } }

    assert_redirected_to settings_path
    assert_equal ["dark", "technical"], [Workspace.default.default_theme, Workspace.default.default_typography]

    get settings_path
    assert_select "nav[aria-label='Settings sections'] a[aria-current='page']", text: "Appearance"
    assert_select "form.settings-card select.settings-control", count: 2
    assert_select "select[name='workspace[theme]'] option[selected][value='dark']"
    assert_select "select[name='workspace[typography]'] option[selected][value='technical']"
  end

  test "creates a document with generic appearance overrides" do
    post documents_path, params: { document: { title: "Styled notes", source: "# Notes", theme: "dark", typography: "technical" } }

    document = Document.find_by!(title: "Styled notes")
    assert_redirected_to edit_document_path(document)
    assert_equal ["dark", "technical"], [document.theme_override, document.typography_override]
  end

  test "search finds old titles headings and content in documents and presentations" do
    renamed = Document.create!(title: "Historical planning notes", source: "# Archive\n\nBackground")
    renamed.update!(title: "Current planning notes")
    heading = Document.create!(title: "Field notebook", source: "# Remote yearbook\n\nDetails from the trip")
    document = Document.create!(title: "Field archive", source: "# Field archive\n\nA distinctive\nbody phrase")
    presentation = Presentation.create!(title: "Search deck", source: "# Search deck\n\nA distinctive\nbody phrase")

    get search_path, params: { q: "Historical" }, as: :json
    assert_response :success
    old_title_result = response.parsed_body["results"].first
    assert_equal renamed.id, old_title_result["id"]
    assert_equal "alias", old_title_result["matched_in"]

    get search_path, params: { q: "remote yearbook", type: "documents" }, as: :json
    assert_equal [heading.id], response.parsed_body["results"].map { |result| result["id"] }

    get search_path, params: { q: "remote yearbook", type: "presentations" }, as: :json
    assert_empty response.parsed_body["results"]

    get search_path, params: { q: '"distinctive body phrase"' }, as: :json
    results = response.parsed_body["results"]
    document_result = results.find { |result| result["id"] == document.id }
    presentation_result = results.find { |result| result["id"] == presentation.id }
    assert_equal "Document", document_result["type_label"]
    assert_equal "Presentation", presentation_result["type_label"]
    assert_includes document_result["context"], "distinctive"
    assert_operator presentation_result["score"], :>, 0
    assert presentation_result["updated_at"].present?
  end

  test "search matches across title and content and ignores accents" do
    work = Document.create!(title: "Café archive", source: "# Archive\n\nThe expedition finished in 2024")

    get search_path, params: { q: "cafe 2024" }, as: :json

    assert_response :success
    assert_equal [work.id], response.parsed_body["results"].map { |result| result["id"] }
  end

  test "workspace settings update handles validation failure" do
    original_default = Workspace.method(:default)
    mock_workspace = Workspace.default
    mock_workspace.define_singleton_method(:update_style_defaults) do |**|
      raise ActiveRecord::RecordInvalid.new(mock_workspace)
    end
    Workspace.define_singleton_method(:default) { mock_workspace }

    patch settings_path, params: { workspace: { theme: "dark", typography: "technical" } }
    assert_redirected_to settings_path
    assert_equal "Choose a valid workspace appearance.", flash[:alert]
  ensure
    Workspace.define_singleton_method(:default, original_default) if original_default
  end
end
