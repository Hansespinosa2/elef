require "test_helper"

class LibraryControllerTest < ActionDispatch::IntegrationTest
  test "root mounts the client shell with presentation actions" do
    Document.create!(title: "Root notes", source: "# Root notes")
    Presentation.create!(title: "Root deck", source: "# Root deck")

    get root_path

    assert_response :success
    assert_shell_boot(path: root_path)
    assert_select "template[data-client-slot='actions'] form[action='#{load_samples_presentations_path}']" do
      assert_select "button", text: "Load sample presentations"
    end
    assert_select "template[data-client-slot='graph']", 1
    assert_select "template[data-client-slot='graph'] .document-graph-panel", count: 0
    assert_select "template[data-client-slot='lineage']", 1
    assert_select "template[data-client-slot='lineage'] .lineage-panel", count: 0
    assert_select "article.library-card", count: 0
    assert_select "a.app-nav-link[href='#{root_path}']", text: "Library"
  end

  test "documents collection boots the shell with document actions and the graph slot" do
    Document.create!(title: "Shell document", source: "# Shell document")

    get documents_path

    assert_response :success
    assert_shell_boot(path: documents_path)
    assert_select "template[data-client-slot='actions'] form[action='#{load_samples_documents_path}']" do
      assert_select "button", text: "Load sample documents"
    end
    assert_select "template[data-client-slot='graph'] .document-graph-panel", 1
    assert_select "template[data-client-slot='lineage'] .lineage-panel", count: 0
    assert_select "article.library-card", count: 0
  end

  test "presentations collection boots the shell with lineage slot and card notes" do
    parent = presentations(:one)
    fork = parent.fork_as("continuation")
    fork.save!

    get presentations_path

    assert_response :success
    assert_shell_boot(path: presentations_path)
    assert_select "template[data-client-slot='actions'] form[action='#{load_samples_presentations_path}']" do
      assert_select "button", text: "Load sample presentations"
    end
    assert_select "template[data-client-slot='lineage'] .lineage-panel", 1
    assert_select "template[data-client-slot='graph'] .document-graph-panel", count: 0
    notes = JSON.parse(css_select("#client-shell-mount").first["data-client-shell-card-notes-value"])
    assert_equal "Forked from Demo Deck · continuation", notes.fetch(fork.id.to_s)
    assert_select "article.library-card", count: 0
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

  def assert_shell_boot(path:)
    mount = css_select("#client-shell-mount")
    assert_equal 1, mount.length
    assert_equal "client-shell", mount.first["data-controller"]
    assert_equal path, mount.first["data-client-shell-initial-url-value"]
    assert_instance_of Hash, JSON.parse(mount.first["data-client-shell-card-notes-value"])
  end
end
