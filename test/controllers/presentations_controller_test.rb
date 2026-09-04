require "test_helper"

class PresentationsControllerTest < ActionDispatch::IntegrationTest
  test "library loads" do
    get presentations_path
    assert_response :success
    assert_select "h1", "Presentation library"
    assert_select 'body.elef-app'
    assert_select 'link[href*="tailwind"]'
    assert_select 'link[href*="katex/katex.min"]'
  end

  test "loads sample presentations idempotently and preserves unrelated records" do
    unrelated = Presentation.create!(title: "Personal deck", source: "# Keep me")

    expected_count = Presentations::SampleData::SAMPLES.length + Presentations::LineageSampleData::SAMPLES.length
    assert_difference("Presentation.count", expected_count) do
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
    assert_equal expected_count,
      Presentation.where.not(sample_id: nil).count
    assert_equal Presentations::SampleData::SAMPLES.length,
      Presentation.where("source LIKE ?", "%#{Presentations::SampleData::MARKER_KEY}%").count
    assert_equal Presentations::LineageSampleData::SAMPLES.length,
      Presentation.where(sample_id: Presentations::LineageSampleData::SAMPLES.map { |sample| sample[:id] }).count
  end

  test "loads samples through the Rails seed entry point" do
    expected_count = Presentations::SampleData::SAMPLES.length + Presentations::LineageSampleData::SAMPLES.length
    assert_difference("Presentation.count", expected_count) do
      Rails.application.load_seed
    end

    assert_no_difference("Presentation.count") do
      Rails.application.load_seed
    end
  end

  test "starts a blank presentation immediately" do
    assert_difference("Presentation.count", 1) do
      post start_presentations_path
    end

    presentation = Presentation.order(:created_at).last
    assert_redirected_to edit_presentation_path(presentation)
    assert_equal Presentation::DEFAULT_SOURCE, presentation.source
  end

  test "renames and deletes a presentation" do
    presentation = presentations(:one)

    patch rename_presentation_path(presentation), params: { presentation: { title: "Renamed deck" } }
    assert_redirected_to presentations_path
    assert_equal "Renamed deck", presentation.reload.title

    assert_difference("Presentation.count", -1) do
      delete presentation_path(presentation)
    end
  end

  test "forks an independent presentation with lineage metadata" do
    parent = presentations(:one)

    assert_difference("Presentation.count", 1) do
      post fork_presentation_path(parent), params: { fork_type: "inspiration" }
    end

    forked = Presentation.order(:created_at).last
    assert_redirected_to edit_presentation_path(forked)
    assert_equal parent, forked.parent
    assert_equal "inspiration", forked.fork_type
    assert_equal parent.source, forked.fork_source
    assert_equal "Demo Deck (Inspiration)", forked.title

    parent.update!(source: "# Changed")
    assert_equal "# One\n\nBody\n---\n# Two", forked.reload.source
  end

  test "renders the lineage graph with relationship styles" do
    Presentations::LineageSampleData.load!

    get presentations_path

    assert_response :success
    assert_select ".lineage-graph .lineage-node", count: 15
    assert_select ".lineage-continuation"
    assert_select ".lineage-inspiration"
    assert_select ".lineage-slide-thumb", count: 15
    assert_select ".lineage-hover-card", count: 15
    assert_select ".lineage-hover-card", text: /Created.*Last published/m
    assert_select ".lineage-graph-canvas[data-controller='lineage-graph']"
    assert_select ".lineage-edges[data-lineage-graph-target='edges']"
    assert_select ".lineage-node[data-lineage-graph-parent-id]", count: 12
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

  test "accepts an autosave update without redirecting" do
    presentation = presentations(:one)

    patch presentation_path(presentation),
      params: { presentation: { title: "Autosaved", source: "# Autosaved" } },
      as: :json

    assert_response :success
    assert_equal "Autosaved", presentation.reload.title
    assert_equal "# Autosaved", presentation.source
    assert_equal presentation.id, response.parsed_body["id"]
  end

  test "renders saved preview and presentation mode" do
    presentation = presentations(:one)

    get presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-surface"
    assert_select ".slide", 2
    assert_select "h1", text: "One"

    get present_presentation_path(presentation)
    assert_response :success
    assert presentation.reload.last_published_at
    assert_select "body.presentation-body"
    assert_select ".presentation-mode.presentation-surface"
    assert_select 'link[href*="tailwind"]', count: 0
    assert_select ".presentation-slide", 2
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
    assert_select ".slide-intro"
    assert_select ".slide-body"

    edge_cases = Presentation.find_by!(sample_id: "slide-edge-cases")
    get presentation_path(edge_cases)

    assert_select ".slide", 10
  end
end
