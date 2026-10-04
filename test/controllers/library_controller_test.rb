require "test_helper"

class LibraryControllerTest < ActionDispatch::IntegrationTest
  test "root renders the combined library at canonical paths" do
    document = Document.create!(title: "Root notes", source: "# Root notes")

    get root_path

    assert_response :success
    config = library_view_config
    assert_equal "Library", config.fetch("title")
    assert_equal "all", config.fetch("filter")
    assert_select "template[data-library-view-slot='cards'] #document_#{document.id}"
    assert_select "template[data-library-view-slot='cards'] #presentation_#{presentations(:one).id}"
    assert_select "template[data-library-view-slot='graph'] .document-graph-panel", count: 0
    assert_select "template[data-library-view-slot='lineage'] .lineage-panel", count: 0
    assert_select "a.app-nav-link[href='#{root_path}']", text: "Library"
    assert_equal({ "all" => root_path, "documents" => documents_path, "presentations" => presentations_path }, config.fetch("routes"))
    assert_select "a[href*='type=']", count: 0
  end

  test "library search is available on every collection view" do
    [root_path, documents_path, presentations_path].each do |path|
      get path

      assert_response :success
      assert_equal true, library_view_config.fetch("searchController")
      assert_select "#library-view-mount[data-library-view-config]", 1
      assert_select "template[data-library-view-slot='cards'] section.library-list", 1
    end
  end

  test "canonical library tabs link to all, documents, and presentations collection paths" do
    [[root_path, "all"], [documents_path, "documents"], [presentations_path, "presentations"]].each do |path, filter|
      get path
      assert_response :success
      config = library_view_config
      assert_equal filter, config.fetch("filter")
      assert_equal({ "all" => root_path, "documents" => documents_path, "presentations" => presentations_path }, config.fetch("routes"))
    end
  end

  test "every library view renders work as a preview card" do
    document = Document.create!(title: "Card document", source: "# Card document\n\nFirst page body.")
    presentation = Presentation.create!(title: "Card deck", source: "# Card deck\n\n---\n\n## Later slide")

    [root_path, documents_path, presentations_path].each do |path|
      get path

      assert_response :success
      assert_select "section.library-list article.library-card", minimum: 1
      assert_select ".library-card .library-preview", minimum: 1
      assert_select ".library-card .library-card-controls", minimum: 1
    end

    [root_path, documents_path].each do |path|
      get path

      assert_select "article#document_#{document.id}" do
        assert_select ".library-preview .document-reader[data-controller~='document-pages'] .document-surface", 1
        assert_select ".library-preview .document-surface h1", text: "Card document"
        assert_select ".library-preview .slide", 0
      end
    end

    [root_path, presentations_path].each do |path|
      get path

      assert_select "article#presentation_#{presentation.id}" do
        assert_select ".library-preview .slide", 1
        assert_select ".library-preview .slide h1", "Card deck"
        assert_select ".library-preview .slide h2", count: 0
        assert_select ".library-preview .document-page", 0
      end
    end
  end

  test "document cards open Edit from the preview, open Preview, and offer only Delete in the menu" do
    document = Document.create!(title: "Quiet document", source: "# Quiet document")

    get documents_path

    assert_select "article#document_#{document.id}" do
      assert_select "a.library-card-open[href=?][aria-label=?]", edit_document_path(document), "Edit Quiet document", 1
      assert_select ".library-card-preview[aria-hidden='true'][inert]", 1
      assert_select "a.library-card-preview-button[href=?]", document_path(document)
      assert_select "summary.library-card-menu-trigger[aria-label=?]", "More actions for Quiet document"
      assert_select "form[action=?]", rename_document_path(document), 1
      assert_select "form[action=?]", document_path(document), 1
      assert_select "form[action=?]", publish_presentation_path(document), 0
      assert_select "form[action=?]", fork_presentation_path(document), 0
      assert_select "h2.library-card-title a[href=?]", edit_document_path(document)
    end
  end

  test "presentation cards open Edit from the preview and offer Delete, Fork, and Present" do
    presentation = Presentation.create!(title: "Loud deck", source: "# Loud deck")

    get presentations_path

    assert_select "article#presentation_#{presentation.id}" do
      assert_select "a.library-card-open[href=?][aria-label=?]", edit_presentation_path(presentation), "Edit Loud deck", 1
      assert_select ".library-card-preview[aria-hidden='true'][inert]", 1
      assert_select "a.library-card-preview-button[href=?]", presentation_path(presentation)
      assert_select "summary.library-card-menu-trigger[aria-label=?]", "More actions for Loud deck"
      assert_select "form[action=?]", rename_presentation_path(presentation), 1
      assert_select "form[action=?]", presentation_path(presentation), 1
      assert_select "form[action=?]", publish_presentation_path(presentation), 1
      assert_select "form[action=?]", fork_presentation_path(presentation), 2
      assert_select "h2.library-card-title a[href=?]", edit_presentation_path(presentation)
    end
  end

  test "card previews are scaled from their design size by the presentation canvas controller" do
    Document.create!(title: "Scaled document", source: "# Scaled document")
    Presentation.create!(title: "Scaled deck", source: "# Scaled deck")

    get root_path

    assert_select ".library-preview[data-controller='presentation-canvas']"
    assert_select ".library-preview-stage > .slide", minimum: 1
    assert_select ".library-preview[data-presentation-canvas-design-width-value='794'][data-presentation-canvas-design-height-value='1123']",
      minimum: 1
    assert_select ".library-preview-page[data-presentation-canvas-target='canvas']", minimum: 1
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

  private

  def library_view_config
    JSON.parse(css_select("#library-view-mount").first["data-library-view-config"])
  end
end
