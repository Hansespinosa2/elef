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

  test "heading marker reveals on entry and clears on leave" do
    document = Document.create!(title: "Reveal", source: "## Warm head\n\nBody here.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection
    assert_no_selector "[data-editor-reveal-prefix]"

    place_caret_in(".document-editor-block h2", offset: 2)
    assert_selector ".document-editor-block h2[data-editor-reveal-prefix='## ']", wait: 5
    assert_equal "## Warm head\n\nBody here.\n", engine_source

    place_caret_in(".document-editor-block p", child_index: 0, offset: 1)
    assert_no_selector "[data-editor-reveal-prefix]", wait: 5
  end

  test "list markers reveal per item and never enter committed text" do
    document = Document.create!(title: "Reveal", source: "- one\n- two\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const li = document.querySelectorAll(".document-editor-block li")[1];
        const range = document.createRange();
        range.setStart(li.firstChild, 1); range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      })()
    JAVASCRIPT
    assert_selector ".document-editor-block li[data-editor-reveal-prefix='- ']", text: "two", wait: 5

    find(".document-editor-block li", text: "two").send_keys("X")
    assert_field "Markdown source", with: "- one\n- tXwo\n", wait: 5
  end

  test "quote markers and nested list indents reveal exactly" do
    document = Document.create!(title: "Reveal", source: "> quoted line\n\n- a\n  - b\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    place_caret_in(".document-editor-block blockquote p", offset: 2)
    assert_selector ".document-editor-block blockquote p[data-editor-reveal-prefix='> ']", wait: 5

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const items = document.querySelectorAll(".document-editor-block li");
        const nested = items[items.length - 1];
        const range = document.createRange();
        range.setStart(nested.firstChild, 0); range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      })()
    JAVASCRIPT
    assert_selector ".document-editor-block li[data-editor-reveal-prefix='  - ']", text: "b", wait: 5
  end

  test "fence delimiters reveal while editing code" do
    document = Document.create!(title: "Reveal", source: "```js\ncode here\n```\n")
    visit edit_document_path(document)
    wait_for_fresh_projection
    assert_no_selector ".editor-reveal-fence"

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const code = document.querySelector(".document-editor-block pre code");
        const text = [...code.childNodes].find((node) => node.nodeType === 3 && (node.textContent || "").includes("code"));
        const range = document.createRange();
        range.setStart(text || code.firstChild, 1); range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      })()
    JAVASCRIPT
    assert_selector ".document-editor-block.editor-reveal-fence[data-editor-reveal-fence-open='```js'][data-editor-reveal-fence-close='```']", wait: 5
    assert_equal "```js\ncode here\n```\n", engine_source
  end

  test "a range across blocks reveals in each block" do
    document = Document.create!(title: "Reveal", source: "First *aa* end.\n\nStart *bb* last.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const ems = document.querySelectorAll(".document-editor-block em");
        const range = document.createRange();
        range.setStart(ems[0].firstChild, 1);
        range.setEnd(ems[1].firstChild, 1);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      })()
    JAVASCRIPT
    assert_selector ".editor-inline-active", count: 2, wait: 5
    assert_equal "First *aa* end.\n\nStart *bb* last.\n", engine_source
  end

  test "a range across pages reveals on both pages" do
    paras = (1..40).map { |i| "Paragraph #{i} with *emphasis* content here." }
    document = Document.create!(title: "Reveal", source: paras.join("\n\n") + "\n")
    visit edit_document_path(document)
    wait_for_fresh_projection
    assert_selector ".document-page-frame", minimum: 2, wait: 10

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const frames = document.querySelectorAll(".document-page-frame");
        const first = frames[0].querySelector(".document-editor-block em").firstChild;
        const last = frames[frames.length - 1].querySelector(".document-editor-block em").firstChild;
        const range = document.createRange();
        range.setStart(first, 1);
        range.setEnd(last, 1);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      })()
    JAVASCRIPT
    assert_selector ".document-page-frame:first-child .editor-inline-active", wait: 5
    assert_selector ".document-page-frame:last-child .editor-inline-active", wait: 5
  end

  test "cross-block deletion replaces the complete selected source range" do
    document = Document.create!(title: "Reveal", source: "First *aa* end.\n\nStart *bb* last.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const ems = document.querySelectorAll(".document-editor-block em");
        ems[0].closest("[contenteditable='true']").focus({ preventScroll: true });
        const range = document.createRange();
        range.setStart(ems[0].firstChild, 1);
        range.setEnd(ems[1].firstChild, 1);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      })()
    JAVASCRIPT
    assert_selector ".editor-inline-active", count: 2, wait: 5
    page.driver.browser.action.send_keys(:backspace).perform
    assert_equal "First *ab* last.\n", engine_source
    # The restored caret reveals the surviving emphasis locally. Once it
    # leaves the passage, the same source must regain reader appearance.
    page.execute_script("document.activeElement?.blur()")
    wait_for_fresh_projection
    assert_selector ".document-editor-block", text: "First ab last.", wait: 10
  end

  test "blocks bound to alignment directives reveal normally" do
    document = Document.create!(title: "Reveal", source: ":::align center\n\n## Headed\n\nBody *warm* here.\n")
    visit edit_document_path(document)
    wait_for_fresh_projection

    place_caret_in(".document-editor-block em", offset: 2)
    assert_selector ".editor-inline-active", text: "*warm*", wait: 5
    place_caret_in(".document-editor-block h2", offset: 2)
    assert_selector ".document-editor-block h2[data-editor-reveal-prefix='## ']", wait: 5
    assert_equal ":::align center\n\n## Headed\n\nBody *warm* here.\n", engine_source
  end

  test "presentation slide emphasis reveals on entry" do
    presentation = Presentation.create!(title: "Reveal", source: "# Slide *one*\n\n---\n\nBody *two* here.\n")
    visit edit_presentation_path(presentation)
    wait_for_fresh_projection
    assert_no_selector ".editor-inline-active"

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const ems = document.querySelectorAll(".presentation-editor-projection em");
        const target = ems[ems.length - 1].firstChild;
        const range = document.createRange();
        range.setStart(target, 1); range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      })()
    JAVASCRIPT
    assert_selector ".editor-inline-active", text: "*two*", wait: 5
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
