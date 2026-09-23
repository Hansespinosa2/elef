require "test_helper"

class PresentationsControllerTest < ActionDispatch::IntegrationTest
  test "library rename form submits scoped parameters" do
    get presentations_path
    assert_select "form[action='#{rename_presentation_path(presentations(:one))}']" do
      assert_select "input[name='presentation[title]']"
    end
  end

  test "renames without changing source and rejects an oversized title" do
    presentation = presentations(:one)
    source = presentation.source
    patch rename_presentation_path(presentation), params: { presentation: { title: "Renamed", source: "overwrite" } }
    assert_redirected_to presentations_path
    assert_equal "Renamed", presentation.reload.title
    assert_equal source, presentation.source

    patch rename_presentation_path(presentation), params: { presentation: { title: "x" * 121 } }
    assert_redirected_to presentations_path
    assert_match /too long/, flash[:alert]
    assert_equal "Renamed", presentation.reload.title
  end

  test "autosaves JSON and returns validation errors without overwriting saved data" do
    presentation = presentations(:one)
    patch presentation_path(presentation), params: { presentation: { source: "# Autosaved" } }, as: :json
    assert_response :ok
    assert_equal presentation.id, response.parsed_body["id"]
    assert_equal "# Autosaved", presentation.reload.source

    patch presentation_path(presentation), params: { presentation: { title: "x" * 121, source: "# Invalid" } }, as: :json
    assert_response :unprocessable_content
    assert_match /too long/, response.parsed_body["errors"].join
    assert_equal "# Autosaved", presentation.reload.source
  end

  test "stale JSON saves return recovery metadata without overwriting the server draft" do
    presentation = Presentation.create!(title: "Concurrent", source: "# Initial")
    lock_version = presentation.lock_version
    base_revision = presentation.revision_token

    patch presentation_path(presentation), params: {
      presentation: { source: "# Server", lock_version: lock_version, base_revision: base_revision }
    }, as: :json
    assert_response :ok

    patch presentation_path(presentation), params: {
      presentation: { source: "# Local", lock_version: lock_version, base_revision: base_revision }
    }, as: :json

    assert_response :conflict
    assert_equal "conflict", response.parsed_body["status"]
    assert_predicate response.parsed_body["recovery_revision_id"], :present?
    assert_equal "# Local", response.parsed_body.dig("recovery_revision", "source")
    assert_equal "# Server", presentation.reload.source
  end

  test "forks both relationship types and rejects unsupported types" do
    parent = presentations(:one)
    Presentation::FORK_TYPES.each do |type|
      assert_difference("Presentation.count") { post fork_presentation_path(parent), params: { fork_type: type } }
      child = parent.children.order(:id).last
      assert_redirected_to edit_presentation_path(child)
      assert_equal type, child.fork_type
      assert_equal parent.source, child.fork_source
    end
    assert_no_difference("Presentation.count") { post fork_presentation_path(parent), params: { fork_type: "invalid" } }
    assert_redirected_to presentations_path
    assert_equal "Choose a valid fork type.", flash[:alert]
  end

  test "deleting a parent retains its fork and provenance" do
    parent = presentations(:one)
    child = parent.fork_as("inspiration")
    child.save!
    assert_difference("Presentation.count", -1) { delete presentation_path(parent) }
    assert_redirected_to presentations_path
    assert_nil child.reload.parent_id
    assert_equal parent.source, child.fork_source
    assert_equal parent.title, child.fork_parent_title
  end

  test "publishing records the last published time while presentation mode stays read-only" do
    presentation = presentations(:one)
    get presentation_path(presentation)
    assert_nil presentation.reload.last_published_at
    freeze_time do
      get present_presentation_path(presentation)
      assert_response :success
      assert_nil presentation.reload.last_published_at

      post publish_presentation_path(presentation)
      assert_redirected_to present_presentation_path(presentation)
      assert_equal Time.current, presentation.reload.last_published_at
    end
  end

  test "present mode remains pinned when the draft changes after publishing" do
    presentation = Presentation.create!(title: "Pinned", source: "# Published")
    post publish_presentation_path(presentation)
    patch presentation_path(presentation), params: { presentation: { source: "# Draft" } }

    get present_presentation_path(presentation)

    assert_response :success
    assert_select ".presentation-slide h1", text: "Published"
    assert_select ".presentation-slide h1", text: "Draft", count: 0
    assert_select ".presentation-release-warning", text: /newer changes/
  end

  test "editor wires autosave and keeps new presentations client-only until creation" do
    get edit_presentation_path(presentations(:one))
    assert_select 'form[data-controller~="autosave"]'
    assert_select "form[action='#{publish_presentation_path(presentations(:one))}'] button.button", text: "Present"
    assert_select 'form[data-controller~="autosave"] form', count: 0
    assert_select '[data-autosave-target="retry"]'
    assert_select '[data-controller~="editor"]'
    assert_select '[data-editor-target="surface"][aria-labelledby]'
    assert_select 'textarea[name="presentation[source]"][data-editor-target="input"]'
    assert_select '[data-editor-target="mode"]', text: "Standard"
    assert_select '[data-editor-target="vimToggle"]'
    assert_select 'button[data-dirty-navigation]', text: "Present"
    get new_presentation_path
    assert_select 'form[data-controller~="autosave"][data-autosave-save-enabled-value="false"]'
    assert_select 'form[data-controller~="preview"]'
    assert_select 'form[data-preview-url-value="/presentations/preview"]'
  end

  test "previews an unsaved presentation without creating a record" do
    assert_no_difference("Presentation.count") do
      post preview_presentations_path, params: {
        presentation: { title: "Draft deck", source: "# Draft deck\n---\n# Next" }, revision: "new-2"
      }, as: :json
    end

    assert_response :success
    assert_equal "new-2", response.parsed_body["revision"]
    assert_equal 2, response.parsed_body["html"].scan('class="slide ').length
    assert_equal "presentation", response.parsed_body.dig("editor_map", "mode")
    assert_equal 2, response.parsed_body.dig("editor_map", "slides").length
  end

  test "editor preview returns editable projections without changing saved output routes" do
    presentation = Presentation.create!(title: "Editable deck", source: "# First\n\nBody")

    post preview_presentation_path(presentation), params: {
      presentation: { source: "# Draft\n\nBody" }, projection: "editor", revision: "editor-1"
    }, as: :json

    assert_response :success
    assert_includes response.parsed_body["html"], 'contenteditable="true"'
    assert_equal "editor-1", response.parsed_body["revision"]
    assert_equal "# First\n\nBody", presentation.reload.source

    get presentation_path(presentation)

    assert_response :success
    assert_select '[contenteditable="true"]', count: 0
  end

  test "the root library shows all work while the presentations URL stays presentation-focused" do
    Document.create!(title: "Root notes", source: "# Root notes")

    get root_path
    assert_response :success
    assert_select "h1", "Library"
    assert_select "#document_#{Document.order(:id).last.id}"

    get presentations_path
    assert_select "h1", "Library"
    assert_select "#document_#{Document.order(:id).last.id}", count: 0
  end

  test "presentation collection no longer interprets type query filters" do
    document = Document.create!(title: "Query notes", source: "# Query notes")

    get presentations_path, params: { type: "all" }

    assert_response :success
    assert_select "#document_#{document.id}", count: 0
    assert_select "#presentation_#{presentations(:one).id}"
  end

  test "the all library is a combined list without relationship graphs" do
    Document.create!(title: "All notes", source: "# Notes")

    get root_path

    assert_select ".document-graph", count: 0
    assert_select ".lineage-panel", count: 0
    assert_select "#document_#{Document.order(:id).last.id}"
    assert_select "#presentation_#{presentations(:one).id}"
  end

  test "library loads" do
    get presentations_path
    assert_response :success
    assert_select "h1", "Library"
    assert_select 'body.elef-app'
    assert_select 'link[href*="tailwind"]'
    assert_select 'link[href*="katex/katex.min"]'
  end

  test "loads sample presentations idempotently and preserves unrelated records" do
    unrelated = Presentation.create!(title: "Personal deck", source: "# Keep me")

    expected_seed_records = Presentations::SampleData::SAMPLES.length + Presentations::LineageSampleData::SAMPLES.length
    assert_difference("Presentation.count", expected_seed_records) do
      post load_samples_presentations_path
    end
    assert_redirected_to presentations_path
    assert_equal "Sample presentations loaded.", flash[:notice]
    Presentations::SampleData::SAMPLES.each do |sample|
      assert_equal sample[:source], Presentation.find_by!(sample_id: sample[:id]).reload.source
    end

    assert_no_difference("Presentation.count") do
      post load_samples_presentations_path
    end
    assert_equal "# Keep me", unrelated.reload.source
    assert_equal expected_seed_records,
      Presentation.where.not(sample_id: nil).count
    assert_equal Presentations::SampleData::SAMPLES.length,
      Presentation.where("source LIKE ?", "%#{Presentations::SampleData::MARKER_KEY}%").count
  end

  test "loads samples through the Rails seed entry point" do
    expected_seed_records = Presentations::SampleData::SAMPLES.length + Presentations::LineageSampleData::SAMPLES.length
    assert_difference("Presentation.count", expected_seed_records) do
      Rails.application.load_seed
    end

    assert_no_difference("Presentation.count") do
      Rails.application.load_seed
    end
  end

  test "creates a presentation from markdown source" do
    assert_difference("Presentation.count", 1) do
      post presentations_path, params: { presentation: { title: "Request Deck", source: "# One\n---\n# Two" } }
    end

    presentation = Presentation.order(:created_at).last
    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "# One\n---\n# Two", presentation.source
  end

  test "updates source only on explicit save request" do
    presentation = presentations(:one)

    patch presentation_path(presentation), params: { presentation: { title: "Updated", source: "# Saved\n---\n# Again" } }

    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "# Saved\n---\n# Again", presentation.reload.source
  end

  test "saves presentation typography in front matter" do
    presentation = presentations(:one)

    patch presentation_path(presentation), params: {
      presentation: { title: presentation.title, source: presentation.source, presentation_typography: "modern" }
    }

    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "modern", presentation.reload.presentation_typography
    assert_includes presentation.source, "presentationTypography: modern"
  end

  test "updates typography inside valid front matter" do
    presentation = Presentation.create!(title: "Front matter deck", source: "---\npresentationTheme: dark\npresentationTypography: modern\n---\n# Title")

    patch presentation_path(presentation), params: {
      presentation: { title: presentation.title, source: presentation.source, presentation_typography: "book" }
    }

    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "book", presentation.reload.presentation_typography
    assert_includes presentation.source, "presentationTheme: dark"
    assert_includes presentation.source, "presentationTypography: book"
  end

  test "renders saved preview and presentation mode" do
    presentation = presentations(:one)

    get presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-surface"
    assert_select ".slides-typography-book"
    assert_select ".slide", 2
    assert_select "h1", text: "One"

    get present_presentation_path(presentation)
    assert_response :success
    assert_select "body.presentation-body"
    assert_select ".presentation-mode.presentation-surface"
    assert_select ".slides-typography-book"
    assert_select 'link[href*="tailwind"]', count: 0
    assert_select 'link[rel="icon"][href="/icon.svg"]'
    assert_select ".presentation-slide", 2
  end

  test "renders margin metadata and slide count in both views" do
    presentation = Presentation.create!(title: "Margin deck", source: <<~MARKDOWN)
      ---
      show-in-margin:
        section: true
        subsection: true
        footnote: true
        slideCount: true
      ---
      :::section{Product strategy}
      :::subsection{Opportunity}
      # First
      :::footnote{Source: customer interviews}
      ---
      # Second
    MARKDOWN

    get presentation_path(presentation)
    assert_select ".slide-margin-section", text: "Product strategy", count: 2
    assert_select ".slide-margin-subsection", text: "Opportunity", count: 2
    assert_select ".slide-margin-footnote", text: /Source: customer interviews/, count: 1
    assert_select ".slide-margin-footnote-marker", text: "*", count: 1
    assert_select ".slide-margin-count", text: "1 / 2", count: 1
    assert_select ".slide-margin-count", text: "2 / 2", count: 1

    get present_presentation_path(presentation)
    assert_select ".presentation-toolbar [data-presentation-target='counter']", count: 0
    assert_select ".presentation-slide .slide-margin-section", text: "Product strategy", count: 2
  end

  test "renders representative sample content in the saved preview" do
    Presentations::SampleData.load!
    sample = Presentation.find_by!(sample_id: "code-and-math")

    get presentation_path(sample)

    assert_response :success
    assert_select ".slides-theme-match"
    assert_select ".katex", 4
    assert_select ".katex-display", 3
    assert_select "pre code", text: /puts/
    assert_select ".slide", 10

    tables_and_media = Presentation.find_by!(sample_id: "tables-and-media")
    get presentation_path(tables_and_media)

    assert_select "table"
    assert_select 'img[alt="Elef authoring workflow"][src="https://example.com/elef-workflow.png"]'
    assert_select 'a[href="https://example.com/elef"]'

    layouts_and_themes = Presentation.find_by!(sample_id: "layouts-and-themes")
    get presentation_path(layouts_and_themes)

    assert_select ".slides-theme-dark"
    assert_select ".slide-body"
    assert_select ".slide-statement"
    assert_select ".slide-two-column .slide-regions", 2
    assert_select ".slide-three-column .slide-regions", 5

    edge_cases = Presentation.find_by!(sample_id: "slide-edge-cases")
    get presentation_path(edge_cases)

    assert_select ".slide", 10
  end

  test "renders every seeded lineage presentation in the timeline" do
    Presentations::LineageSampleData.load!

    get presentations_path

    assert_response :success
    assert_select ".lineage-timeline-scroll"
    assert_select ".lineage-node", count: Presentation.count
    assert_select ".lineage-node[data-lineage-graph-created-at]", count: Presentation.count
    assert_select ".lineage-date-axis"
  end

  test "editor exposes the presentation typography selector" do
    get edit_presentation_path(presentations(:one))

    assert_response :success
    assert_select "select[name='presentation[presentation_typography]']" do
      assert_select "option[value='book']", text: "Book"
      assert_select "option[value='modern']", text: "Modern"
      assert_select "option[value='technical']", text: "Technical"
    end
  end

  test "renders positioning warnings without leaking directives" do
    presentation = Presentation.create!(title: "Warnings", source: "# Slide\n\n:::unknown\n\nContent")

    get presentation_path(presentation)

    assert_response :success
    assert_select '[aria-label="Markdown warnings"]', text: /directive/
    assert_select ".slide", text: /Content/
    refute_includes response.body, ":::unknown"
  end
end
