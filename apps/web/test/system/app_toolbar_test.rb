require "application_system_test_case"

class AppToolbarTest < ApplicationSystemTestCase
  def capture_toolbar(name)
    return unless ENV["ELEF_VISUAL_EVIDENCE"]

    directory = Pathname.new(ENV.fetch("ELEF_VISUAL_EVIDENCE"))
    FileUtils.mkdir_p(directory)
    page.save_screenshot(directory.join("toolbar-#{name}.png"))
  end

  test "the toolbar hides, restores, and keeps its choice when navigating between work types" do
    document = Document.create!(title: "Toolbar document", source: "# Toolbar document")
    presentation = Presentation.create!(title: "Toolbar presentation", source: "# Toolbar presentation")
    visit root_path
    assert_selector ".app-toolbar .toolbar-library", visible: true
    capture_toolbar("library")
    find("label.app-toolbar-toggle").click
    assert_no_selector ".app-toolbar .toolbar-library", visible: true
    assert_operator page.evaluate_script('document.querySelector(".app-header").getBoundingClientRect().height'), :<, 30

    visit edit_document_path(document)
    assert_no_selector ".app-toolbar #work-export-menu-button", visible: true
    find("label.app-toolbar-toggle").click
    assert_selector ".app-toolbar #work-export-menu-button", visible: true
    assert_no_selector ".app-toolbar [data-command-palette-present]"
    capture_toolbar("document")
    assert_operator page.evaluate_script('document.querySelector(".app-header").getBoundingClientRect().height'), :<=, 40

    find("#toggle-editor-library-sidebar").click
    assert_selector '#toggle-editor-library-sidebar[aria-pressed="true"]'
    find("#toggle-editor-library-sidebar").click
    assert_selector '#toggle-editor-library-sidebar[aria-pressed="false"]'

    visit edit_presentation_path(presentation)
    assert_selector ".app-toolbar #work-export-menu-button", visible: true
    assert_selector ".app-toolbar [data-command-palette-present]", visible: true
    capture_toolbar("presentation")
    assert_operator page.evaluate_script('document.querySelector(".editor-shell").getBoundingClientRect().bottom'), :<=, page.evaluate_script("window.innerHeight + 1")
  end
end
