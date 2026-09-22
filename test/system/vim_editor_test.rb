require "application_system_test_case"

class VimEditorTest < ApplicationSystemTestCase
  test "editor controls fit a narrow viewport and retain resizing" do
    document = Document.create!(title: "Mobile editor", source: "# Mobile")
    visit edit_document_path(document)
    [500, 390, 320].each do |width|
      page.driver.browser.manage.window.resize_to(width, 800)
      assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=,
        page.evaluate_script("window.innerWidth")
    end

    page.driver.browser.manage.window.resize_to(500, 800)
    assert_equal "vertical", page.evaluate_script("getComputedStyle(document.querySelector('.editor-surface')).resize")
    assert_equal "hidden", page.evaluate_script("getComputedStyle(document.querySelector('.editor-surface')).overflow")

    find("summary", text: "Vim settings").click
    panel = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const rect = document.querySelector('.editor-settings-panel').getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: rect.width }
      })()
    JAVASCRIPT
    assert_operator panel["left"], :>=, 0
    assert_operator panel["right"], :<=, page.evaluate_script("window.innerWidth")
    save_screenshot("tmp/screenshots/editor/mobile-vim-settings.png")
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "Vim mode transitions and edits synchronize the Rails source" do
    document = Document.create!(title: "Vim notes", source: "# First\n# Second\n# Third")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys("i")
    assert_selector "[data-editor-target='mode'][data-mode='insert']", text: "Insert"
    editor.send_keys("Inserted ", :escape)
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    editor.send_keys("v", "l")
    assert_selector "[data-editor-target='mode'][data-mode='visual']", text: "Visual"
    editor.send_keys(:escape)

    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys("dd")
    assert_equal "# Second\n# Third", find_field("Markdown source").value
    assert_selector "[data-autosave-target='status']", text: "Saved", wait: 5
  end

  test "Vim settings persist per browser" do
    document = Document.create!(title: "Vim settings", source: "# Settings")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    select "Enter Insert mode", from: "Shift+Space in Normal mode"
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    assert_selector "[data-editor-target='vimToggle']:checked"
    assert_equal "insert", find("[data-editor-target='mapping']").value
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
  end

  test "metadata directives are visually subdued without dimming fenced code" do
    document = Document.create!(title: "Metadata styling", source: <<~MARKDOWN)
      # Notes

      :::position{center}

      Visible text.

      ```
      :::not-metadata
      ```
    MARKDOWN
    visit edit_document_path(document)

    assert_selector ".cm-elef-metadata", text: ":::position{center}"
    assert_no_selector ".cm-elef-metadata", text: ":::not-metadata"
    assert_equal "0.68", page.evaluate_script("getComputedStyle(document.querySelector('.cm-elef-metadata')).opacity")
  end

  test "configured Shift+Space enters Insert mode" do
    document = Document.create!(title: "Vim mapping", source: "# Mapping")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    select "Enter Insert mode", from: "Shift+Space in Normal mode"
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    editor.send_keys([:shift, :space])
    assert_selector "[data-editor-target='mode'][data-mode='insert']", text: "Insert"
  end

  test "Vim edits update a presentation preview and autosave" do
    presentation = Presentation.create!(title: "Vim deck", source: "# Original")
    visit edit_presentation_path(presentation)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(2, 2)")
    editor.send_keys("i", "Vim ", :escape)

    assert_selector ".preview-pane .slide", text: "Vim Original", wait: 5
    assert_selector "[data-autosave-target='status']", text: "Saved", wait: 5
    assert_includes presentation.reload.source, "# Vim Original"
  end

  test "turning Vim off restores ordinary editing" do
    document = Document.create!(title: "Standard editing", source: "# Standard")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    find("[data-editor-target='vimToggle']").uncheck
    assert_selector "[data-editor-target='mode'][data-mode='standard']", text: "Standard"
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    editor.send_keys(" ordinary")
    assert_includes find_field("Markdown source").value, " ordinary"
  end
end
