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
    active_color = page.evaluate_script('getComputedStyle(document.querySelector(".toolbar-library")).color')
    settings_color = page.evaluate_script('getComputedStyle(document.querySelector(".toolbar-settings")).color')
    refute_equal settings_color, active_color, "the current location should use the green active color"
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
    assert_selector "body.is-editing-source", visible: :all
    assert_operator page.evaluate_script('document.querySelector(".editor-shell").getBoundingClientRect().bottom'), :<=, page.evaluate_script("window.innerHeight + 1")
  end
  test "source preview remains scrollable beneath the toolbar" do
    original_size = page.driver.browser.manage.window.size
    source = "# Long document\n\n" + 70.times.map { |i| "Paragraph #{i}: #{'long document text ' * 8}\n\n" }.join
    document = Document.create!(title: "Toolbar scroll document", source: source)
    visit edit_document_path(document, editor_mode: "source")
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 30
    metrics = page.evaluate_script(<<~JS)
      (() => { const pane = document.querySelector('[data-preview-target="container"]');
      pane.scrollTop = pane.scrollHeight;
      return {top: pane.scrollTop, height: pane.clientHeight, scrollHeight: pane.scrollHeight}; })()
    JS
    assert_operator metrics.fetch("top"), :>, 200, metrics.inspect
    wide = page.evaluate_script('document.querySelector(".document-page-frame").getBoundingClientRect().width')
    page.driver.browser.manage.window.resize_to(600, 500)
    assert Selenium::WebDriver::Wait.new(timeout: 10).until {
      page.evaluate_script(<<~JS)
        (() => { const frame = document.querySelector(".document-page-frame");
        const preview = frame.closest(".preview-pane");
        return frame.getBoundingClientRect().width < #{wide} - 1 && frame.getBoundingClientRect().width <= preview.clientWidth + 1; })()
      JS
    }, "the document page should fit and shrink in a narrower preview"
  ensure
    page.driver.browser.manage.window.resize_to(original_size.width, original_size.height) if original_size
  end

end
