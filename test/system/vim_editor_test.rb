require "application_system_test_case"

class VimEditorTest < ApplicationSystemTestCase
  test "Vim mode transitions and edits synchronize the Rails source" do
    document = Document.create!(title: "Vim notes", source: "# First\n# Second\n# Third")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

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
end
