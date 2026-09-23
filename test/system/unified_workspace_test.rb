require "application_system_test_case"

class UnifiedWorkspaceTest < ApplicationSystemTestCase
  test "opens the command palette with Mod+K and searches works" do
    target = Document.create!(title: "Palette target", source: "# Palette target")
    source = Document.create!(title: "Palette source", source: "# Palette source")

    visit edit_document_path(source)
    page.driver.browser.action.key_down(:control).send_keys("k").key_up(:control).perform
    assert_selector "dialog.command-palette[open]"

    fill_in "Search works or run a command…", with: "Palette target"
    assert_selector ".command-palette-option", text: target.title, wait: 5
    find(".command-palette-option", text: target.title).click

    assert_current_path document_path(target)
  end

  test "uses the math shortcut palette for aliases inside math" do
    document = Document.create!(title: "Math palette", source: "# Math palette")

    visit edit_document_path(document)
    page.execute_script("const editor = document.querySelector('.source-field').editorController; editor.setSelectionRange(editor.value.length, editor.value.length); editor.focus();")
    editor = find(".cm-content")
    editor.send_keys("\n$x.b")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Bold/, wait: 5
    editor.send_keys(:enter)

    editor.send_keys("\n@a")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Alpha/, wait: 5
    editor.send_keys(:enter)

    source = find_field("Markdown source").value
    assert_includes source, "$\\mathbf{x}"
    assert_includes source, "\\alpha"
  end

  test "collapses front matter and reveals it on demand" do
    document = Document.create!(
      title: "Metadata notes",
      source: "---\ntheme: dark\ntypography: modern\n---\n# Metadata notes\n\nBody"
    )

    visit edit_document_path(document)
    assert_selector ".cm-foldPlaceholder", wait: 5
    click_on "Reveal source metadata"
    assert_no_selector ".cm-foldPlaceholder"
    assert_selector ".cm-content", text: "theme: dark"
  end

  test "keeps the source pane wider on desktop and stacks on narrow screens" do
    document = Document.create!(title: "Responsive editor", source: "# Responsive editor\n\nBody")

    visit edit_document_path(document)
    desktop = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const layout = document.querySelector(".editor-layout");
        const source = layout.querySelector(".source-pane").getBoundingClientRect();
        const preview = layout.querySelector(".preview-pane").getBoundingClientRect();
        return { source: source.width, preview: preview.width };
      })()
    JAVASCRIPT
    assert_operator desktop["source"], :>, desktop["preview"]

    page.driver.browser.manage.window.resize_to(700, 900)
    assert_equal "flex", page.evaluate_script("getComputedStyle(document.querySelector('.editor-layout')).display")
    assert_equal "column", page.evaluate_script("getComputedStyle(document.querySelector('.editor-layout')).flexDirection")
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end
end
