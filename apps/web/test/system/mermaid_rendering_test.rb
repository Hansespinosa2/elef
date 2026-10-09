require "application_system_test_case"

class MermaidRenderingTest < ApplicationSystemTestCase
  DIAGRAM = "```mermaid\nflowchart LR\n  A[Research] --> B[Design]\n```"

  test "a rendered document draws the diagram instead of the fence source" do
    document = Document.create!(title: "Mermaid document", source: "# Outline\n\n#{DIAGRAM}\n")

    visit document_path(document)

    assert_selector "pre.mermaid[data-processed] svg", wait: 30
    assert_no_selector "pre.mermaid code.highlight"
    assert_equal 1, page.evaluate_script("document.querySelectorAll('pre.mermaid svg').length")
  end

  test "a rendered presentation draws the diagram instead of the fence source" do
    presentation = Presentation.create!(title: "Mermaid deck", source: "# Outline\n\n#{DIAGRAM}\n")

    visit presentation_path(presentation)

    assert_selector "pre.mermaid[data-processed] svg", wait: 30
    assert_no_selector "pre.mermaid code.highlight"
  end

  test "the editor projection and live preview draw the diagram" do
    document = Document.create!(title: "Mermaid editor", source: "Intro paragraph.\n\n#{DIAGRAM}\n")

    visit edit_document_path(document)

    assert_selector ".document-editor-projection pre.mermaid[data-processed] svg", wait: 30

    # Live preview draws diagrams as CodeMirror widgets whenever the caret sits
    # outside the fence.
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")

    assert_selector ".cm-live-widget-mermaid svg", wait: 30
    assert_no_selector ".cm-live-widget-mermaid.mermaid-error"
  end

  test "editing around a diagram leaves the fence source intact" do
    document = Document.create!(title: "Mermaid round trip", source: "Intro paragraph.\n\n#{DIAGRAM}\n")

    visit edit_document_path(document)
    block = find(".document-editor-projection [contenteditable='true']", match: :first)
    block.click
    block.send_keys(:home, "Edited. ")
    assert_field "Markdown source", with: /Edited\. Intro paragraph\./, wait: 10

    visit document_path(document)

    assert_selector "pre.mermaid[data-processed] svg", wait: 30
    assert_equal "Intro paragraph.\n\n#{DIAGRAM}\n", document.reload.source
  end

  test "an invalid diagram leaves the fence source visible" do
    document = Document.create!(title: "Mermaid invalid", source: "```mermaid\nnot a diagram\n```\n")

    visit document_path(document)

    assert_selector "pre.mermaid.mermaid-error", wait: 30
    assert_includes page.find("pre.mermaid").text, "not a diagram"
  end

  test "inserting /diagram renders a diagram on the rendered work" do
    document = Document.create!(title: "Mermaid inserted", source: "# Existing text")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    editor.send_keys(:enter, "/diagram")

    assert_selector ".mermaid-assist-option", text: "Flowchart / process", wait: 5
    find(".mermaid-assist-option", text: "Flowchart / process").click
    editor = find(".cm-content")
    editor.send_keys("Research", :enter)
    assert_field "Markdown source", with: /A\[Research\] --> B\[\]/, wait: 5
    editor.send_keys("Design")
    assert_field "Markdown source", with: /A\[Research\] --> B\[Design\]/, wait: 5

    assert_selector '[data-autosave-target="status"]', text: "Saved", wait: 10
    assert_includes document.reload.source, "A[Research] --> B[Design]"

    visit document_path(document)

    assert_selector "pre.mermaid[data-processed] svg", wait: 30
  end
end
