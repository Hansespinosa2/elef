require "application_system_test_case"

class PresentationsTest < ApplicationSystemTestCase
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
