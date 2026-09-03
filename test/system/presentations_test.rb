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
  end

  test "renders the code and math sample with block display math" do
    Presentations::SampleData.load!

    visit presentations_path
    within("article", text: "Sample: Code and LaTeX math") do
      click_on "Preview"
    end

    assert_selector ".katex", count: 2, visible: true
    assert_selector ".katex-display", visible: true
    assert_selector ".katex-html", visible: true
    assert_text "$not_math$"
    assert_no_selector ".math-error"
    assert_equal "block",
      page.evaluate_script("getComputedStyle(document.querySelector('.katex-display')).display")
    assert_equal "absolute",
      page.evaluate_script("getComputedStyle(document.querySelector('.katex-mathml')).position")
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
