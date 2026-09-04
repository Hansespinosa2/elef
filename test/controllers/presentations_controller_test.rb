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

    assert_difference("Presentation.count", Presentations::SampleData::SAMPLES.length) do
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
    assert_equal Presentations::SampleData::SAMPLES.length,
      Presentation.where.not(sample_id: nil).count
    assert_equal Presentations::SampleData::SAMPLES.length,
      Presentation.where("source LIKE ?", "%#{Presentations::SampleData::MARKER_KEY}%").count
  end

  test "loads samples through the Rails seed entry point" do
    assert_difference("Presentation.count", Presentations::SampleData::SAMPLES.length) do
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

  test "renders saved preview and presentation mode" do
    presentation = presentations(:one)

    get presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-surface"
    assert_select ".slide", 2
    assert_select "h1", text: "One"

    get present_presentation_path(presentation)
    assert_response :success
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
    assert_select ".slide-body"
    assert_select ".slide-statement"
    assert_select ".slide-two-column .slide-regions", 2
    assert_select ".slide-three-column .slide-regions", 5

    edge_cases = Presentation.find_by!(sample_id: "slide-edge-cases")
    get presentation_path(edge_cases)

    assert_select ".slide", 10
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
