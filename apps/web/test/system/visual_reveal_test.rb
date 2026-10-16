require "application_system_test_case"

class VisualRevealTest < ApplicationSystemTestCase
  def wait_for_fresh_projection
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 10
  end

  def engine_source
    page.evaluate_script("document.querySelector('.source-field').editorController.value")
  end

  def place_caret_in(selector, child_index: 0, offset: 1)
    page.execute_script(<<~JAVASCRIPT, selector, child_index, offset)
      (() => {
        const target = document.querySelector(arguments[0]);
        const node = target.childNodes[arguments[1]];
        const range = document.createRange();
        range.setStart(node, arguments[2]);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const editable = target.closest("[contenteditable='true']") || target;
        editable.focus({ preventScroll: true });
      })()
    JAVASCRIPT
  end

  test "entering emphasis reveals its delimiters without touching source" do
    document = Document.create!(title: "Reveal", source: "A *warm* word.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection
    assert_no_selector ".editor-inline-active"

    find(".document-editor-block", text: "warm").click
    place_caret_in(".document-editor-block em", offset: 2)
    assert_selector ".editor-inline-active", text: "*warm*", wait: 5
    assert_equal "A *warm* word.\n", engine_source
  end

  test "leaving a revealed construct restores its rendered form" do
    document = Document.create!(title: "Reveal", source: "A *warm* word.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection
    place_caret_in(".document-editor-block em", offset: 2)
    assert_selector ".editor-inline-active", text: "*warm*", wait: 5

    place_caret_in(".document-editor-block p", child_index: 0, offset: 1)
    assert_no_selector ".editor-inline-active", wait: 5
    assert_selector ".document-editor-block em", text: "warm"
    assert_equal "A *warm* word.\n", engine_source
  end

  test "typing inside revealed emphasis commits at the caret" do
    document = Document.create!(title: "Reveal", source: "A *warm* word.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection
    place_caret_in(".document-editor-block em", offset: 2)
    assert_selector ".editor-inline-active", text: "*warm*", wait: 5

    find(".editor-inline-active").send_keys("X")
    assert_field "Markdown source", with: "A *waXrm* word.\n", wait: 5
  end

  test "overwriting revealed delimiters un-formats in the source" do
    document = Document.create!(title: "Reveal", source: "A *warm* word.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection
    place_caret_in(".document-editor-block em", offset: 2)
    assert_selector ".editor-inline-active", text: "*warm*", wait: 5

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const span = document.querySelector(".editor-inline-active");
        const range = document.createRange();
        range.selectNodeContents(span.firstChild);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      })()
    JAVASCRIPT
    find(".editor-inline-active").send_keys("calm")
    assert_field "Markdown source", with: "A calm word.\n", wait: 5
  end

  test "strong and code reveal on entry" do
    document = Document.create!(title: "Reveal", source: "A **bold** move and `cell` code.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    place_caret_in(".document-editor-block strong", offset: 2)
    assert_selector ".editor-inline-active", text: "**bold**", wait: 5
    assert_equal "A **bold** move and `cell` code.\n", engine_source

    place_caret_in(".document-editor-block code", offset: 2)
    assert_selector ".editor-inline-active", text: "`cell`", wait: 5
    assert_equal "A **bold** move and `cell` code.\n", engine_source
  end

  test "Vim normal motion into emphasis reveals it" do
    document = Document.create!(title: "Reveal", source: "A *warm* word.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    visit edit_document_path(document)
    wait_for_fresh_projection

    place_caret_in(".document-editor-block p", child_index: 0, offset: 1)
    assert_no_selector ".editor-inline-active"
    page.send_keys(:escape)
    2.times { page.send_keys("l") }
    assert_selector ".editor-inline-active", text: "*warm*", wait: 5
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "fenced code never activates while table emphasis reveals" do
    source = "# T\n\n```js\nconst star = \"*\"\n```\n\n| a |\n| - |\n| *b* |\n"
    document = Document.create!(title: "Reveal", source: source)
    visit edit_document_path(document)
    wait_for_fresh_projection

    find(".document-editor-block", text: "const star").click
    sleep 0.5
    assert_no_selector ".editor-inline-active"
    # Table-cell emphasis is genuine rendered emphasis, so it reveals.
    find(".document-editor-block td em", text: "b").click
    assert_selector ".editor-inline-active", text: "*b*", wait: 5
  end

  test "emphasis containing math stays rendered" do
    document = Document.create!(title: "Reveal", source: "A *mix $x$ up* word.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    em = find(".document-editor-block em", wait: 5)
    page.execute_script(<<~JAVASCRIPT, em)
      (() => {
        const target = arguments[0];
        const range = document.createRange();
        range.setStart(target.firstChild, 2);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      })()
    JAVASCRIPT
    sleep 0.7
    assert_no_selector ".editor-inline-active"
    assert_selector ".document-editor-block em"
  end
end
