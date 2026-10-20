require "test_helper"

class LibraryControllerTest < ActionDispatch::IntegrationTest
  test "root mounts the client shell with presentation actions" do
    Document.create!(title: "Root notes", source: "# Root notes")
    Presentation.create!(title: "Root work", source: "# Root work")

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
    assert_select "template[data-client-slot='graph'] [data-graph-data]", 1
    assert_select "template[data-client-slot='graph'] .document-graph-panel", count: 0
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
    assert_equal "Forked from Demo Work · continuation", notes.fetch(fork.id.to_s)
    assert_select "article.library-card", count: 0
  end

  test "command palette lists every registry palette action with chords" do
    # Palette completeness: the web palette must list every palette-flagged
    # entry of the shared registry (packages/client shortcuts, source of
    # truth), so no action is mouse-only. Labels mirror the registry.
    get root_path

    assert_response :success
    palette = css_select(".command-palette-root").first
    commands = JSON.parse(palette["data-command-palette-commands-value"])
    ids = commands.map { |command| command["id"] }
    expected = %w[
      quick-open new-presentation new-document new-snippet change-appearance
      open-settings open-snippets open-math-shortcuts library-all
      library-documents library-presentations save toggle-vim vim-settings
      toggle-metadata keyboard-shortcuts present print download-pptx report-bug
      load-samples slide-add slide-duplicate slide-delete slide-move-up
      slide-move-down
    ]
    missing = expected - ids
    assert_empty missing, "palette is missing registry actions: #{missing.inspect}"
    save = commands.find { |command| command["id"] == "save" }
    assert_equal "s", save["shortcutKey"]
    present = commands.find { |command| command["id"] == "present" }
    assert_equal "Enter", present["shortcutKey"]
    # User-visible contract: every palette row shows a label and a
    # description; the added/changed rows mirror the shared registry exactly.
    by_id = commands.to_h { |command| [command["id"], command] }
    expected.each do |id|
      assert by_id[id]["label"].to_s.strip != "", "palette #{id} label is empty"
      assert by_id[id]["description"].to_s.strip != "", "palette #{id} description is empty"
    end
    registry_copy = {
      "save" => ["Save current work", "Submit the active editor"],
      "present" => ["Present work", "Publish and open the presentation stage"],
      "print" => ["Print / save PDF", "Open the print view for the current work"],
      "download-pptx" => ["Download PowerPoint", "Export the current presentation as .pptx"],
      "report-bug" => ["Report a bug", "Open the bug report dialog"],
      "load-samples" => ["Load sample works", "Seed the library with sample documents"],
      "slide-add" => ["Add slide", "Add a slide after the selected slide"],
      "slide-duplicate" => ["Duplicate slide", "Duplicate the selected slide"],
      "slide-delete" => ["Delete slide", "Delete the selected slide"],
      "slide-move-up" => ["Move slide earlier", "Move the selected slide earlier"],
      "slide-move-down" => ["Move slide later", "Move the selected slide later"]
    }
    registry_copy.each do |id, (label, description)|
      assert_equal label, by_id[id]["label"], "palette #{id} label drifted from the registry"
      assert_equal description, by_id[id]["description"], "palette #{id} description drifted from the registry"
    end
  end

  test "search endpoint returns JSON results with type filtering and fallback" do
    doc = Document.create!(title: "Research Alpha", source: "# Alpha notes\n\nContent")
    pres = Presentation.create!(title: "Work Alpha", source: "# Alpha work\n\nContent")

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
    assert mount.first.has_attribute?("data-bug-report-ignore"), "library mount must ignore bug-report capture (rename/new/search leak titles)"
    assert_select "dialog.command-palette[data-bug-report-ignore]", count: 1
    assert_equal path, mount.first["data-client-shell-initial-url-value"]
    assert_instance_of Hash, JSON.parse(mount.first["data-client-shell-card-notes-value"])
  end
end
