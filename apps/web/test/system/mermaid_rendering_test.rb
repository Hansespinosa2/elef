require "application_system_test_case"

class MermaidRenderingTest < ApplicationSystemTestCase
  DIAGRAM = "```mermaid\nflowchart LR\n  A[Research] --> B[Design]\n```"

  test "rendered documents and presentations draw diagrams instead of fence source" do
    [
      [Document, ->(work) { document_path(work) }],
      [Presentation, ->(work) { presentation_path(work) }]
    ].each do |work_class, path_for|
      work = work_class.create!(title: "Mermaid #{work_class.name}", source: "# Outline\n\n#{DIAGRAM}\n")

      visit path_for.call(work)

      assert_selector "pre.mermaid[data-processed] svg", wait: 30
      assert_no_selector "pre.mermaid code.highlight"
    end
    assert_equal 1, page.evaluate_script("document.querySelectorAll('pre.mermaid svg').length")
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

end
