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

  test "entering a link reveals its URL and typing commits" do
    document = Document.create!(title: "Reveal", source: "See [docs](https://x.test/d) now.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection
    assert_no_selector ".editor-inline-active"

    place_caret_in(".document-editor-block a", offset: 2)
    assert_selector ".editor-inline-active", text: "[docs](https://x.test/d)", wait: 5
    assert_equal "See [docs](https://x.test/d) now.\n", engine_source

    find(".editor-inline-active").send_keys("X")
    assert_field "Markdown source", with: "See [doXcs](https://x.test/d) now.\n", wait: 5
  end

  test "a range across constructs reveals every one it touches" do
    document = Document.create!(title: "Reveal", source: "A *warm* and [cool](https://x.test) word.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const p = document.querySelector(".document-editor-block p");
        const range = document.createRange();
        range.setStart(p.childNodes[0], 0);
        range.setEnd(p.childNodes[p.childNodes.length - 1], p.childNodes[p.childNodes.length - 1].textContent.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      })()
    JAVASCRIPT
    assert_selector ".editor-inline-active", count: 2, wait: 5
    assert_selector ".editor-inline-active", text: "*warm*"
    assert_selector ".editor-inline-active", text: "[cool](https://x.test)"
    assert_equal "A *warm* and [cool](https://x.test) word.\n", engine_source
  end

  test "unresolved document links never activate" do
    document = Document.create!(title: "Reveal", source: "Open [[No Such Doc 12345]] please.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    find(".document-editor-block .document-link.unresolved").click
    sleep 0.7
    assert_no_selector ".editor-inline-active"
  end

  test "autolinks do not block emphasis revelation in the same block" do
    document = Document.create!(title: "Reveal", source: "Visit https://x.test/a and *warm* word.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    place_caret_in(".document-editor-block em", offset: 2)
    assert_selector ".editor-inline-active", text: "*warm*", wait: 5
    assert_equal "Visit https://x.test/a and *warm* word.\n", engine_source
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
