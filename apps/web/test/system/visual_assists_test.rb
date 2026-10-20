require "application_system_test_case"

class VisualAssistsTest < ApplicationSystemTestCase
  def wait_for_fresh_projection
    selector = "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    return if has_selector?(selector, wait: 2)

    assert_selector(selector, wait: 10)
  end

  def engine_source
    page.evaluate_script("document.querySelector('.source-field').editorController.value")
  end

  test "visual snippet palette opens on slash and accepts with Enter" do
    document = Document.create!(title: "Visual snippet", source: "# Notes\n\nBody")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Body")
    block.click
    block.send_keys(:end, " /table")

    assert_selector ".snippet-palette:not([hidden]) .snippet-option", text: "Table", wait: 5
    block.send_keys(:enter)

    assert_field "Markdown source", with: /Body \| Column 1 \| Column 2 \|/, wait: 5
    assert_includes engine_source, "| --- | --- |"
  end

  test "visual and source snippet accepts produce identical source" do
    source = "# Notes\n\nBody"
    keys = [:end, " /table", :enter]

    visual = Document.create!(title: "Visual parity", source: source)
    visit edit_document_path(visual)
    wait_for_fresh_projection
    block = find(".document-editor-block", text: "Body")
    block.click
    block.send_keys(*keys)
    assert_field "Markdown source", with: /\| Column 1 \|/, wait: 5
    visual_source = engine_source

    sourced = Document.create!(title: "Source parity", source: source)
    visit edit_document_path(sourced)
    click_on "Source"
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    editor.send_keys(*keys)
    assert_field "Markdown source", with: /\| Column 1 \|/, wait: 5

    assert_equal visual_source, engine_source
  end

  test "visual typing preserves a trailing space before the caret" do
    document = Document.create!(title: "Trailing space", source: "# Notes\n\nSee ")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "See")
    block.click
    block.send_keys(:end, "x")

    assert_field "Markdown source", with: /See x/, wait: 5
  end

  test "visual document link palette accepts with Tab" do
    Document.create!(title: "Research target", source: "# Target")
    document = Document.create!(title: "Research source", source: "# Notes\n\nSee ")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "See")
    block.click
    block.send_keys(:end, "[[Research ta")

    assert_selector ".document-link-option", text: "Research target", wait: 5
    block.send_keys(:tab)

    assert_field "Markdown source", with: /See \[\[Research target\]\]/, wait: 5
  end

  test "visual math shortcut palette opens inside math" do
    document = Document.create!(title: "Visual math", source: "# Notes\n\nBody")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Body")
    block.click
    block.send_keys(:end, " $@a")

    assert_selector ".math-shortcut-palette:not([hidden]) .snippet-option", text: /alpha/i, wait: 5
    block.send_keys(:enter)

    assert_field "Markdown source", with: /\\alpha/, wait: 5
  end

  test "visual mermaid /diagram chains to types and inserts the template" do
    document = Document.create!(title: "Visual diagram", source: "# Existing text")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Existing text")
    block.click
    block.send_keys(:end, :enter)
    wait_for_fresh_projection

    fresh = all(".document-editor-block").last
    fresh.click
    fresh.send_keys("/diagram")

    assert_selector ".mermaid-assist-option", text: "Flowchart / process", wait: 5
    fresh.send_keys(:enter)

    assert_field "Markdown source", with: /```mermaid\nflowchart LR/, wait: 5
  end

  test "visual math shorthand commits with Space" do
    document = Document.create!(title: "Visual shorthand", source: "# Notes\n\nBody")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Body")
    block.click
    block.send_keys(:end, " $x.b", " ")

    assert_field "Markdown source", with: /\\mathbf\{x\} /, wait: 5
  end

  test "Edit-actions menu inserts a snippet trigger in visual mode" do
    document = Document.create!(title: "Visual menu", source: "# Notes\n\nBody")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Body")
    block.click
    block.send_keys(:end)
    click_on "Edit"
    click_on "Insert snippet or directive"

    assert_selector ".snippet-palette:not([hidden]) .snippet-option", wait: 5
    assert_field "Markdown source", with: %r{Body/}, wait: 5
  end

  test "keyboard reference opens from the menu and the command palette" do
    document = Document.create!(title: "Visual reference", source: "# Notes\n\nBody")
    visit edit_document_path(document)
    wait_for_fresh_projection

    click_on "Edit"
    click_on "Keyboard shortcuts…"
    assert_selector "dialog.keyboard-reference[open]", text: "Save current work", wait: 5
    click_on "Close"
    assert_no_selector "dialog.keyboard-reference[open]"

    click_on "Commands"
    search = find_field("Filter commands…")
    search.send_keys("Keyboard shortcuts", :enter)
    assert_selector "dialog.keyboard-reference[open]", text: "Save current work", wait: 5
  end

  test "visual presentation snippet palette accepts in a slide block" do
    presentation = Presentation.create!(title: "Visual slides", source: "# Title\n\nBody")
    visit edit_presentation_path(presentation)
    wait_for_fresh_projection

    block = find(".presentation-editor-projection [contenteditable='true']", text: "Body")
    block.click
    block.send_keys(:end, " /table")

    assert_selector ".snippet-palette:not([hidden]) .snippet-option", text: "Table", wait: 5
    block.send_keys(:enter)

    assert_field "Markdown source", with: /Body \| Column 1 \|/, wait: 5
  end

  test "presentation Edit menu omits the document-link row" do
    presentation = Presentation.create!(title: "Slide menu", source: "# Title\n\nBody")
    visit edit_presentation_path(presentation)
    wait_for_fresh_projection

    find(".presentation-editor-projection [contenteditable='true']", text: "Body").click
    within("form.visual-editor-form") { find(".edit-actions-button").click }

    assert_selector '[data-edit-actions-row="trigger:snippet"]'
    assert_no_selector '[data-edit-actions-row="trigger:link"]'
    assert_selector '[data-edit-actions-row="keyboard-shortcuts"]'
  end
  test "visual find uses the engine search panel in both work kinds" do
    [Document, Presentation].each do |model|
      source = "# Search\n\nA *warm* word.\n\nAnother warm word."
      work = model.create!(title: "Search", source: source)
      visit model == Document ? edit_document_path(work) : edit_presentation_path(work)
      assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 10
      block = find(".editor-projection [contenteditable='true']", text: "Another warm word.")
      block.click
      block.send_keys([RUBY_PLATFORM.match?(/darwin/) ? :meta : :control, "f"])
      field = find('.visual-engine-panels input[name="search"]')
      field.set("warm")
      field.send_keys(:enter)
      assert_selector '.visual-engine-panels input[name="search"]:focus'
      assert_equal "visual", page.evaluate_script("document.querySelector('form.visual-editor-form').dataset.editorMode")
      assert_field "Markdown source", with: source
      assert page.evaluate_script("window.getSelection().toString().includes('warm')")
    end
  end

end
