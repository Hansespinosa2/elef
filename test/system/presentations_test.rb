require "application_system_test_case"

class PresentationsTest < ApplicationSystemTestCase
  test "loads sample presentations from the library" do
    Presentation.delete_all

    visit presentations_path
    assert_text "No presentations yet"
    click_on "Load sample presentations"

    assert_text "Sample presentations loaded."
    Presentations::SampleData::SAMPLES.each do |sample|
      assert_text sample[:title]
    end
    Presentations::LineageSampleData::SAMPLES.each do |sample|
      assert_text sample[:title]
    end
  end

  test "shows the seeded lineage tree in the library" do
    Presentations::LineageSampleData.load!

    visit presentations_path

    assert_selector ".lineage-graph .lineage-node", count: 15
    assert_selector ".lineage-continuation"
    assert_selector ".lineage-inspiration"
    assert_equal 12, page.evaluate_script("document.querySelectorAll('.lineage-edge').length")
    edge_endpoints = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll('.lineage-edge')].map((edge) => {
        const values = edge.getAttribute('d').match(/-?[\\d.]+/g).map(Number);
        const from = document.querySelector(`[data-lineage-graph-id="${edge.dataset.lineageEdgeFrom}"]`);
        const to = document.querySelector(`[data-lineage-graph-id="${edge.dataset.lineageEdgeTo}"]`);
        const center = (node) => ({
          x: parseFloat(node.style.left) + 88,
          y: parseFloat(node.style.top) + 50
        });
        return {
          start: { x: values[0], y: values[1] },
          end: { x: values[values.length - 2], y: values[values.length - 1] },
          from: center(from),
          to: center(to)
        };
      });
    JAVASCRIPT
    edge_endpoints.each do |edge|
      assert_in_delta edge["from"]["y"], edge["start"]["y"], 0.1
      assert_in_delta edge["to"]["y"], edge["end"]["y"], 0.1
      assert_in_delta 88, (edge["start"]["x"] - edge["from"]["x"]).abs, 0.1
      assert_in_delta 88, (edge["end"]["x"] - edge["to"]["x"]).abs, 0.1
    end
    click_on "Open Quarterly Review June"
    assert_field "Markdown source", with: /Quarterly Review June/
  end

  test "preserves a 16:9 slide surface across views" do
    parent = Presentation.create!(title: "Ratio deck", source: "# First slide\n\nContent\n---\n# Second slide")
    child = parent.fork_as("continuation")
    child.save!

    visit presentation_path(parent)
    preview_ratio = page.evaluate_script("(function(){ const r = document.querySelector('.slides > .slide').getBoundingClientRect(); return r.width / r.height })()")

    visit present_presentation_path(parent)
    presentation_ratio = page.evaluate_script("(function(){ const r = document.querySelector('.presentation-slide .slide').getBoundingClientRect(); return r.width / r.height })()")

    visit presentations_path
    lineage_ratio = page.evaluate_script("(function(){ const r = document.querySelector('[data-lineage-graph-id=\\\"#{parent.id}\\\"] .slide').getBoundingClientRect(); return r.width / r.height })()")

    assert_in_delta 16.0 / 9.0, preview_ratio, 0.02
    assert_in_delta preview_ratio, presentation_ratio, 0.02
    assert_in_delta preview_ratio, lineage_ratio, 0.02
  end

  test "renders the code and math sample with block display math" do
    Presentations::SampleData.load!

    visit presentations_path
    within("article", text: "Sample: Code and LaTeX math") do
      click_on "Preview"
    end

    assert_selector ".katex", count: 4, visible: true
    assert_selector ".katex-display", visible: true
    assert_selector ".katex-html", visible: true
    assert_selector ".mfrac .frac-line", visible: true
    assert_selector ".msupsub", visible: true
    assert_text "$not_math$"
    assert_no_selector ".math-error"
    assert_equal "block",
      page.evaluate_script("getComputedStyle(document.querySelector('.katex-display')).display")
    assert_equal "absolute",
      page.evaluate_script("getComputedStyle(document.querySelector('.katex-mathml')).position")
    fraction_parts = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".mfrac > .vlist-t > .vlist-r:first-child > .vlist > span > .mord")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      })
    JAVASCRIPT
    assert_operator fraction_parts.length, :>=, 2
    assert_operator (fraction_parts[1]["top"] - fraction_parts[0]["top"]).abs, :>, 1
  end

  test "keeps Elef UI and presentation surfaces as separate styling zones" do
    presentation = Presentation.create!(title: "Scoped Deck", source: "# Scoped\n\n- One\n- Two")

    visit presentations_path
    assert_selector "body.elef-app"
    refute_selector "body.presentation-body"

    visit presentation_path(presentation)
    assert_selector "body.elef-app"
    assert_selector ".presentation-surface"
    assert_equal "disc",
      page.evaluate_script("getComputedStyle(document.querySelector('.presentation-surface ul')).listStyleType")

    visit present_presentation_path(presentation)
    assert_selector "body.presentation-body"
    assert_selector ".presentation-mode.presentation-surface"
    refute_selector "body.elef-app"
  end

  test "starts every regular slide header at the same inset" do
    presentation = Presentation.create!(
      title: "Header alignment",
      source: "# Short slide\n\nA short body.\n---\n# Code-heavy slide\n\n```ruby\n#{'  ' * 2}records.each { |record| process(record) }\n#{'  ' * 2}records.each { |record| process(record) }\n```\n\nAdditional body content."
    )

    visit presentation_path(presentation)

    header_offsets = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".slide")].map((slide) => {
        const header = slide.querySelector("h1");
        const slideRect = slide.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        return headerRect.top - slideRect.top;
      })
    JAVASCRIPT

    assert_equal 2, header_offsets.length
    assert_equal header_offsets.first, header_offsets.last
  end

  test "user creates saves and reopens a markdown presentation" do
    visit presentations_path
    click_on "New presentation", match: :first

    fill_in "Title", with: "System Deck"
    fill_in "Markdown source", with: "# First\n\nBody\n---\n# Second"
    click_on "Save presentation"

    assert_text "Presentation saved."
    assert_field "Markdown source", with: "# First\n\nBody\n---\n# Second"
    assert_selector ".slide", count: 2

    click_on "Library"
    click_on "System Deck"
    assert_field "Markdown source", with: "# First\n\nBody\n---\n# Second"
  end

  test "dirty source warns before navigation and cancel preserves edits" do
    presentation = Presentation.create!(title: "Dirty Deck", source: "# Saved")

    visit edit_presentation_path(presentation)
    fill_in "Markdown source", with: "# Unsaved"

    dismiss_confirm do
      click_on "Library"
    end

    assert_current_path edit_presentation_path(presentation)
    assert_field "Markdown source", with: "# Unsaved"
  end

  test "presentation mode advances with keyboard" do
    presentation = Presentation.create!(title: "Presenter", source: "# One\n---\n# Two")

    visit present_presentation_path(presentation)
    assert_text "1 / 2"
    assert_selector ".presentation-slide", text: "One", visible: :visible

    send_keys :arrow_right
    assert_text "2 / 2"
    assert_selector ".presentation-slide", text: "Two", visible: :visible

    send_keys :arrow_left
    assert_text "1 / 2"
  end
end
