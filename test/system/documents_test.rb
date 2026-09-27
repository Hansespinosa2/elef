require "application_system_test_case"

class DocumentsTest < ApplicationSystemTestCase
  def wait_for_fresh_projection
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 5
  end

  def wait_for_preview_response(count)
    ready = page.evaluate_async_script(<<~JAVASCRIPT, count)
      const count = arguments[0];
      const done = arguments[arguments.length - 1];
      const deadline = Date.now() + 5000;
      const wait = () => {
        if ((window.previewResponses || []).length >= count) return done(true);
        if (Date.now() >= deadline) return done(false);
        window.setTimeout(wait, 10);
      };
      wait();
    JAVASCRIPT
    assert ready, "preview response count #{count} was not registered"
  end

  def type_visual_text(selector, source_text, replacement)
    wait_for_fresh_projection
    attempts = 0
    loop do
      source_before = find_field("Markdown source").value
      expected_source = source_before.sub(source_text, replacement)
      assert_not_equal source_before, expected_source, "could not find source text #{source_text.inspect}"
      target = all(selector, wait: 5).find { |candidate| candidate.text.include?(source_text) }
      assert target, "could not find visual text #{source_text.inspect} in #{selector}"

      begin
        target.click
        selected = page.execute_script(<<~JAVASCRIPT, target, source_text)
          const root = arguments[0];
          const needle = arguments[1];
          const editableBlock = root.closest("[contenteditable='true']") || root;
          editableBlock.focus({ preventScroll: true });
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const nodes = [];
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.parentElement?.closest('[data-editor-math-source]')) nodes.push(node);
          }
          const combined = nodes.map((node) => node.textContent).join('');
          const start = combined.indexOf(needle);
          if (start < 0) return false;
          const point = (offset) => {
            let consumed = 0;
            for (const node of nodes) {
              const end = consumed + node.textContent.length;
              if (offset <= end) return [node, offset - consumed];
              consumed = end;
            }
            const last = nodes[nodes.length - 1];
            return last ? [last, last.textContent.length] : null;
          };
          const from = point(start);
          const to = point(start + needle.length);
          if (!from || !to) return false;
          const range = document.createRange();
          range.setStart(from[0], from[1]);
          range.setEnd(to[0], to[1]);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return {
            focused: document.activeElement === editableBlock,
            selected: selection.toString() === needle
          };
        JAVASCRIPT
        assert selected && selected["focused"] && selected["selected"],
          "could not focus #{source_text.inspect} and select it for visual editing"
        target.find(:xpath, "ancestor-or-self::*[@contenteditable='true'][1]").send_keys(replacement)
        return
      rescue Selenium::WebDriver::Error::StaleElementReferenceError
        attempts += 1
        return if find_field("Markdown source").value == expected_source
        raise if attempts >= 3
      end
    end
  end

  def type_source_text(source, source_text, replacement)
    start = source.index(source_text)
    assert start, "could not find source text #{source_text.inspect}"
    page.execute_script(<<~JAVASCRIPT, start, start + source_text.length)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(arguments[0], arguments[1]);
      editor.focus();
    JAVASCRIPT
    find(".cm-content").send_keys(replacement)
  end

  def active_document_block
    assert_selector ".document-editor-block[data-editor-block-id]:focus", wait: 5
    block_id = page.evaluate_script("document.activeElement.closest('.document-editor-block')?.dataset.editorBlockId")
    assert block_id, "expected the visual document editor to keep a block focused"
    find(".document-editor-block[data-editor-block-id='#{block_id}']")
  end

  test "suggests document links in the Markdown editor" do
    Document.create!(title: "Research target", source: "# Target")
    document = Document.create!(title: "Research source", source: "# Source")

    visit edit_document_path(document)
    editor = find_field("Markdown source")
    fill_in "Markdown source", with: "# Source\n\n    [[Not a link]]\n\n[[Research ta"

    assert_selector ".document-link-option", text: "Research target", wait: 5
    editor.send_keys(:enter)
    assert_includes editor.value, "[[Research target]]"
  end

  test "suggests document links from the visible CodeMirror editor" do
    Document.create!(title: "Research target", source: "# Target")
    document = Document.create!(title: "Research source", source: "# Source")

    visit edit_document_path(document)
    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    editor.send_keys("i", "[[Research ta")

    assert_selector ".document-link-option", text: "Research target", wait: 5
    assert_selector ".document-link-option[aria-selected='true']", text: "Research target"
    assert_equal "true", page.evaluate_script("document.querySelector('.cm-editor').getAttribute('aria-expanded')")
    editor.send_keys(:enter)
    assert_includes find_field("Markdown source").value, "[[Research target]]"
  end

  test "navigates resolved document links to previews" do
    target = Document.create!(title: "Linked target", source: "# Linked target")
    source = Document.create!(title: "Linked source", source: "See [[Linked target]]")

    visit document_path(source)
    click_on "Linked target"

    assert_current_path document_path(target)
    assert_selector ".document-surface h1", text: "Linked target"
  end

  test "keeps links editable in the visual surface instead of navigating" do
    Document.create!(title: "Editable target", source: "# Target")
    source = Document.create!(title: "Editable source", source: "See [[Editable target]]")

    visit edit_document_path(source)
    within ".editor-projection" do
      click_on "Editable target"
    end

    assert_current_path edit_document_path(source)
    assert page.evaluate_script("Boolean(document.activeElement.closest('[contenteditable=\\\"true\\\"]'))")
  end

  test "shows orphan nodes and supports graph search, zoom, and responsive layout" do
    target = Document.create!(title: "Graph target", source: "# Target")
    source = Document.create!(title: "Graph source", source: "See [[Graph target]]")
    orphan = Document.create!(title: "Graph orphan with a long mobile document label", source: "# Orphan")

    visit documents_path
    assert_selector ".document-graph-node", count: 3
    assert_selector ".document-graph-node-hit-area", count: 3, visible: :all
    assert_selector ".document-graph-edge[data-source-id='#{source.id}'][data-target-id='#{target.id}']", visible: :all
    edge_colors = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const edge = document.querySelector('.document-graph-edge');
        const arrow = document.querySelector('#document-graph-arrow path');
        return { edge: getComputedStyle(edge).stroke, arrow: getComputedStyle(arrow).fill };
      })()
    JAVASCRIPT
    assert_equal edge_colors["edge"], edge_colors["arrow"]

    fill_in "Find a document", with: "Graph orphan"
    assert_selector ".document-graph-results button", text: orphan.title
    within ".document-graph-results" do
      click_on orphan.title
    end
    assert_selector ".document-graph-node.is-highlighted", count: 1

    fill_in "Find a document", with: "Graph source"
    assert_selector ".document-graph-node.is-search-match", count: 1
    fill_in "Find a document", with: ""
    assert_no_selector ".document-graph-node.is-search-match"

    edge_geometry = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const edge = document.querySelector('.document-graph-edge');
        const source = document.querySelector(".document-graph-node[data-node-id='#{source.id}']").getAttribute('transform').match(/translate\\(([^ ]+) ([^)]+)\\)/);
        const target = document.querySelector(".document-graph-node[data-node-id='#{target.id}']").getAttribute('transform').match(/translate\\(([^ ]+) ([^)]+)\\)/);
        return { targetGap: Math.hypot(Number(target[1]) - Number(edge.getAttribute('x2')), Number(target[2]) - Number(edge.getAttribute('y2'))), sourceGap: Math.hypot(Number(source[1]) - Number(edge.getAttribute('x1')), Number(source[2]) - Number(edge.getAttribute('y1'))) };
      })()
    JAVASCRIPT
    assert_operator edge_geometry["targetGap"], :>=, 12
    assert_operator edge_geometry["sourceGap"], :>=, 12

    find("[aria-label='Zoom in']").click
    assert_selector "[data-document-graph-target='scaleLabel']", text: "120%"
    assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=, page.evaluate_script("window.innerWidth")

    find("[aria-label='Reset graph view']").click
    page.driver.browser.manage.window.resize_to(600, 900)
    assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=, page.evaluate_script("window.innerWidth")
    assert_operator page.evaluate_script("document.querySelector('.document-graph-node text').getBoundingClientRect().height"), :>=, 10
    label_overflow = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const canvas = document.querySelector('.document-graph-canvas').getBoundingClientRect();
        const labels = [...document.querySelectorAll('.document-graph-node text')];
        return labels.reduce((overflow, label) => {
          const bounds = label.getBoundingClientRect();
          return {
            left: Math.max(overflow.left, canvas.left - bounds.left),
            right: Math.max(overflow.right, bounds.right - canvas.right)
          };
        }, { left: 0, right: 0 });
      })()
    JAVASCRIPT
    assert_operator label_overflow["left"], :<=, 2
    assert_operator label_overflow["right"], :<=, 2
    find(".document-graph-node[data-node-id='#{orphan.id}']").click
    assert_current_path document_path(orphan)
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "document and presentation graph panels share the workspace shell styling" do
    Document.create!(title: "Graph styling document", source: "# Graph styling document")
    Presentation.create!(title: "Graph styling presentation", source: "# Graph styling presentation")

    visit documents_path
    document_panel_style = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const panel = document.querySelector('.document-graph-panel');
        const description = panel.querySelector('.mb-4 > div > p:not(.eyebrow)');
        return {
          background: getComputedStyle(panel).backgroundColor,
          border: getComputedStyle(panel).borderColor,
          shadow: getComputedStyle(panel).boxShadow,
          heading: getComputedStyle(panel.querySelector('h2')).color,
          description: getComputedStyle(description).color,
          legend: getComputedStyle(panel.querySelector('.document-graph-legend')).color
        };
      })()
    JAVASCRIPT

    visit presentations_path
    presentation_panel_style = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const panel = document.querySelector('.lineage-panel');
        const description = panel.querySelector('.mb-4 > div > p:not(.eyebrow)');
        return {
          background: getComputedStyle(panel).backgroundColor,
          border: getComputedStyle(panel).borderColor,
          shadow: getComputedStyle(panel).boxShadow,
          heading: getComputedStyle(panel.querySelector('h2')).color,
          description: getComputedStyle(description).color,
          legend: getComputedStyle(panel.querySelector('.lineage-legend')).color
        };
      })()
    JAVASCRIPT

    assert_equal presentation_panel_style, document_panel_style
  end

  test "creates a document and updates its continuous live preview" do
    visit new_document_path
    assert_no_selector "#document_title"
    fill_in "Markdown source", with: "# Research notes\n\nFirst section\n\n---\n\nSecond section"
    assert_selector ".document-surface", text: "Second section", wait: 5
    assert_selector ".document-surface hr"
    click_on "Save document"

    assert_text "Document saved."
    assert_current_path %r{/documents/\d+/edit}
    assert_equal "Research notes", Document.order(:id).last.title
    assert_selector ".document-surface h1", text: "Research notes"
    fill_in "Markdown source", with: "# Research notes\n\nA live update\n\n---\n\nSecond section"
    assert_selector ".document-surface", text: "A live update", wait: 5
    assert_includes Document.order(:id).last.source, "Second section"
  end

  test "new document typing keeps Markdown blocks, title, lists, quotes, and math in sync" do
    expected_source = File.read(Rails.root.join("test/fixtures/files/visual_editor_document_flow.md")).chomp

    visit root_path
    find(".new-work-menu summary").click
    find(".new-work-option", text: "Document").click
    wait_for_fresh_projection

    assert_no_selector "#document_title"
    assert_selector ".document-editor-block h1", text: "Untitled document"
    focused_title = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const heading = document.querySelector('.document-editor-block h1');
        const selection = window.getSelection();
        if (!heading || !selection?.isCollapsed || !heading.contains(selection.anchorNode)) return false;
        const end = document.createRange();
        end.selectNodeContents(heading);
        end.collapse(false);
        return selection.anchorNode === end.endContainer && selection.anchorOffset === end.endOffset;
      })()
    JAVASCRIPT
    assert_equal true, focused_title, "new documents should focus the end of the first heading"

    title = find(".document-editor-block", text: "Untitled document")
    title.send_keys(*Array.new("Untitled document".length + 6, :backspace))
    assert_field "Markdown source", with: "# ", wait: 5
    title.send_keys(*Array.new(6, :backspace))
    assert_field "Markdown source", with: "# ", wait: 5
    title.send_keys(" This is my First Document")
    assert_field "Markdown source", with: "# This is my First Document", wait: 5
    title.send_keys(:enter)
    assert_field "Markdown source", with: "# This is my First Document\n\n", wait: 5

    first_paragraph = active_document_block
    first_paragraph.send_keys("This is my first line in this document and it is a normal paragraph that may even wrap around. It creates one coherent block of text that can span one line or multiple depending on font or any other specific formatting, but it is one block.")
    assert_equal "true", first_paragraph["contenteditable"], "typing should keep the focused block editable while preview refreshes"
    first_paragraph.send_keys(:enter)
    assert_field "Markdown source", with: /one block\.\n\n\z/, wait: 5
    empty_paragraph = active_document_block
    assert_equal "true", empty_paragraph["data-editor-empty-block"], "Enter should focus a new empty document block"
    empty_paragraph.send_keys(:backspace)
    assert_field "Markdown source", with: /one block\.\z/, wait: 5
    paragraph_after_backspace = active_document_block
    assert_includes paragraph_after_backspace.text, "This is my first line in this document"
    paragraph_after_backspace.send_keys(:enter)
    list_block = active_document_block
    assert_equal "true", list_block["data-editor-empty-block"], "Enter after Backspace should focus a new empty block"
    list_block.send_keys("- THis is the first item of a list")
    assert_field "Markdown source", with: /\n\n- THis is the first item of a list\z/, wait: 5
    active_document_block.send_keys(:enter)
    assert_field "Markdown source", with: /- THis is the first item of a list\n- \z/, wait: 5
    assert_selector ".document-editor-block ul > li", count: 2, wait: 5
    active_document_block.send_keys("This is the second item of the same list.")
    assert_field "Markdown source", with: /- THis is the first item of a list\n- This is the second item of the same list\.\z/, wait: 5
    active_document_block.send_keys(:enter)
    active_document_block.send_keys(:enter)
    assert_field "Markdown source", with: /- This is the second item of the same list\.\n\n\z/, wait: 5

    # Backspace on the empty paragraph removes it and returns the caret to the list.
    active_document_block.send_keys(:backspace)
    assert_field "Markdown source", with: /- This is the second item of the same list\.\z/, wait: 5
    active_document_block.send_keys(:enter)
    active_document_block.send_keys(:enter)
    active_document_block.send_keys("> A quoted line")
    active_document_block.send_keys(:enter)
    active_document_block.send_keys("with a second line")
    active_document_block.send_keys(:enter)
    active_document_block.send_keys(:enter)
    assert_field "Markdown source", with: /> A quoted line\n> with a second line\n\n\z/, wait: 5

    active_document_block.send_keys("Inline math: $E = mc^2$.")
    active_document_block.send_keys(:enter)
    active_document_block.send_keys("Display math: $$\\frac{1}{2}$$.")
    active_document_block.send_keys(:enter)
    active_document_block.send_keys("A final paragraph.")
    assert_field "Markdown source", with: expected_source, wait: 5
    assert_selector ".document-editor-block .katex", minimum: 2, wait: 5

    click_on "Save document"
    assert_text "Document saved."
    document = Document.order(:id).last
    assert_equal "This is my First Document", document.title
    assert_equal expected_source, document.source

    visit edit_document_path(document)
    assert_no_selector "#document_title"
    assert_selector ".document-editor-block h1", text: "This is my First Document"
    assert_field "Markdown source", with: expected_source

    final_paragraph = find(".document-editor-block", text: "A final paragraph.")
    final_paragraph.click
    focused_paragraph = page.evaluate_script(
      "document.activeElement.closest('.document-editor-block')?.textContent.includes('A final paragraph.')"
    )
    assert_equal true, focused_paragraph
    final_paragraph.send_keys(:end, " Continued")
    assert_field "Markdown source", with: expected_source.sub("A final paragraph.", "A final paragraph. Continued"), wait: 5
  end

  test "visual document editing preserves untouched Markdown and survives reopening" do
    document = Document.create!(title: "Visual notes", source: "# Original\n\n**Keep formatting**\n\nUnchanged")

    visit edit_document_path(document)

    assert_equal "visual", page.evaluate_script("document.querySelector('form.visual-editor-form').dataset.editorMode")
    find(".document-editor-block", text: "Original").click
    page.execute_script("const block = document.querySelector('.document-editor-block'); block.innerText = 'Renamed'; block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Renamed' }));")
    assert_field "Markdown source", with: "# Renamed\n\n**Keep formatting**\n\nUnchanged", wait: 5
    assert_selector ".document-editor-block strong", text: "Keep formatting"

    click_on "Source"
    assert_selector ".editor-projection[aria-label='Rendered preview']", visible: true
    assert_selector ".cm-content", visible: true
    click_on "Visual"
    click_on "Save document"

    assert_text "Document saved."
    visit edit_document_path(document)
    assert_field "Markdown source", with: "# Renamed\n\n**Keep formatting**\n\nUnchanged"
    assert_selector ".document-editor-block", text: "Renamed"
    assert_selector ".document-editor-block strong", text: "Keep formatting"
  end

  test "enter splits a document block at the visible caret" do
    document = Document.create!(title: "Caret split", source: "# Notes\n\nAlpha beta gamma")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Alpha beta gamma")
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let textNode;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes('gamma')) {
          textNode = walker.currentNode;
          break;
        }
      }
      if (!textNode) throw new Error('Paragraph text was not found');
      const range = document.createRange();
      range.setStart(textNode, textNode.textContent.indexOf('gamma'));
      range.collapse(true);
      block.focus();
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    JAVASCRIPT
    block.send_keys(:enter)

    assert_field "Markdown source", with: "# Notes\n\nAlpha beta\n\ngamma", wait: 5
    assert_selector ".document-editor-block", text: "Alpha beta"
    assert_selector ".document-editor-block", text: "gamma"
  end

  test "visual document blocks accept direct keyboard edits" do
    document = Document.create!(title: "Typing notes", source: "# Typing notes\n\nBody")

    visit edit_document_path(document)
    block = find(".document-editor-block", text: "Body")
    block.click
    block.send_keys(:end, " changed")

    assert_field "Markdown source", with: "# Typing notes\n\nBody changed", wait: 5
  end

  test "visual text edits coalesce source updates within a frame" do
    document = Document.create!(title: "Batched visual edits", source: "# Batch\n\nOriginal")
    visit edit_document_path(document)
    block = find(".document-editor-block", text: "Original")

    result = page.evaluate_async_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      const done = arguments[arguments.length - 1];
      const editor = document.querySelector(".source-field").editorController;
      const replaceRanges = editor.replaceRanges.bind(editor);
      let updates = 0;
      editor.replaceRanges = (changes) => { updates += 1; replaceRanges(changes); };
      block.focus({ preventScroll: true });
      ["One", "Two", "Final text"].forEach((value) => {
        block.textContent = value;
        block.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      });
      requestAnimationFrame(() => requestAnimationFrame(() => done({ updates, source: editor.value })));
    JAVASCRIPT

    assert_equal 1, result["updates"]
    assert_equal "# Batch\n\nFinal text", result["source"]
  end

  test "visual and source modes carry the caret position in both directions" do
    source = "# Notes\n\nFirst paragraph\n\nSecond paragraph"
    document = Document.create!(title: "Caret handoff", source: source)
    visit edit_document_path(document)

    first = find(".document-editor-block", text: "First paragraph")
    page.execute_script(<<~JAVASCRIPT, first)
      const block = arguments[0];
      const text = block.querySelector("p").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 5);
    JAVASCRIPT
    click_on "Source"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    expected = source.index("First paragraph") + 5
    assert_equal expected, page.evaluate_script("document.querySelector('.source-field').editorController.view.state.selection.main.head")

    click_on "Visual"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    restored = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const selection = window.getSelection();
        const element = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement;
        const block = element?.closest(".document-editor-block");
        return { text: block?.innerText, offset: selection.focusOffset, active: document.activeElement === block };
      })()
    JAVASCRIPT
    assert_equal "First paragraph", restored["text"].strip
    assert_equal 5, restored["offset"]
    assert_equal true, restored["active"]

    click_on "Source"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    second_position = source.index("Second paragraph") + 7
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(arguments[0])", second_position)
    click_on "Visual"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    restored = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const selection = window.getSelection();
        const element = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement;
        const block = element?.closest(".document-editor-block");
        return { text: block?.innerText, offset: selection.focusOffset, active: document.activeElement === block };
      })()
    JAVASCRIPT
    assert_equal "Second paragraph", restored["text"].strip
    assert_equal 7, restored["offset"]
    assert_equal true, restored["active"]
  end

  test "up and down move the caret between visual blocks and backspace removes an empty block" do
    document = Document.create!(
      title: "Block navigation",
      source: "# Navigation\n\nFirst block\n\nSecond block\n\nThird block"
    )
    visit edit_document_path(document)

    first = find(".document-editor-block", text: "First block")
    navigation = page.execute_script(<<~JAVASCRIPT, first)
      const block = arguments[0];
      const text = block.querySelector("p").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, text.textContent.length);
      const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      block.dispatchEvent(down);
      const next = document.activeElement;
      const held = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true, repeat: true });
      next.dispatchEvent(held);
      return [down.defaultPrevented, held.defaultPrevented];
    JAVASCRIPT
    assert_equal [true, true], navigation
    assert_equal "Third block", page.evaluate_script("document.activeElement.innerText.trim()")

    empty = find(".document-editor-block", text: "Second block")
    removed = page.execute_script(<<~JAVASCRIPT, empty)
      const block = arguments[0];
      block.innerHTML = "<br>";
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(block, 0);
      const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
      block.dispatchEvent(event);
      return event.defaultPrevented;
    JAVASCRIPT
    assert_equal true, removed
    assert_field "Markdown source", with: "# Navigation\n\nFirst block\n\nThird block", wait: 5
  end

  test "hitting enter at the end of a block and deleting the empty block preserves surrounding blocks" do
    %w[Delete Backspace].each do |key|
      sample = Documents::SampleData::SAMPLES.find { |s| s[:id] == "document-full-report" }
      document = Document.create!(title: "#{sample[:title]} #{key}", source: sample[:source])
      visit edit_document_path(document)
      wait_for_fresh_projection

      first_block = find(".document-editor-block", text: /This report examines a simple proposition/)
      first_block_id = first_block["data-editor-block-id"]
      assert first_block_id
      before = find_field("Markdown source").value

      # Hit Enter at the end of the block
      created = page.execute_script(<<~JAVASCRIPT, first_block)
        const block = arguments[0];
        block.focus({ preventScroll: true });
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let lastTextNode = null;
        while (walker.nextNode()) {
          lastTextNode = walker.currentNode;
        }
        window.getSelection().setPosition(lastTextNode, lastTextNode.textContent.length);
        const enterEvent = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
        block.dispatchEvent(enterEvent);
        return enterEvent.defaultPrevented;
      JAVASCRIPT
      assert_equal true, created

      # Wait for the source to reflect the split (extra blank line), then for the preview to re-render
      assert_no_field "Markdown source", with: before, wait: 5
      wait_for_fresh_projection

      # The empty placeholder block should now be focused
      empty_block = active_document_block
      assert_equal "true", empty_block["data-editor-empty-block"]

      # Press Delete or Backspace on the empty block
      empty_block.send_keys(key == "Delete" ? :delete : :backspace)

      # The Markdown source should be back to the original source without collapsing paragraphs
      assert_field "Markdown source", with: before, wait: 5
      assert_equal first_block_id, active_document_block["data-editor-block-id"]
    end
  end

  test "visual edits preserve soft line breaks around inline math" do
    source = <<~MARKDOWN
      # Notes

      The relationship is $E = mc^2$ in inline form, while this display
      equation gives the reader a larger landmark.
    MARKDOWN
    document = Document.create!(title: "Soft breaks with math", source: source)

    visit edit_document_path(document)
    rendered_text = page.execute_script(<<~JAVASCRIPT)
      const block = [...document.querySelectorAll(".document-editor-block")]
        .find((element) => element.textContent.includes("The relationship"));
      block.style.whiteSpace = "pre-line";
      return block.innerText;
    JAVASCRIPT
    assert_includes rendered_text, "display\nequation"

    type_visual_text(".document-editor-block", "The relationship", "The equation relationship")

    assert_field "Markdown source", with: source.sub("The relationship", "The equation relationship"), wait: 5
    refute_includes find_field("Markdown source").value, "\uE000"
  end

  test "typing in visual and source modes has identical fixture Markdown" do
    fixtures = [
      {
        id: "document-markdown-tour",
        operations: [
          [".document-editor-block", "Fixture: Markdown tour", "Fixture: Markdown tour", "Markdown parity tour"],
          [".document-editor-block", "qualification", "qualification", "qualified note"],
          [".document-editor-block", "Start with the question.", "Start with the question.", "Start with the right question."],
          [".document-editor-block", "Gather context.", "Gather context.", "Gather useful context."],
          [".document-editor-block", "The best source is readable before it is rendered.", "The best source is readable before it is rendered.", "The best source stays readable before it is rendered."],
          [".document-editor-block", "visit the Elef project", "visit the Elef project", "visit the Elef authoring project"]
        ]
      },
      {
        id: "document-components",
        operations: [
          [".document-editor-block", "Fixture: Rich components", "Fixture: Rich components", "Rich component parity"],
          [".document-editor-block", "Markdown first", "Markdown first", "Markdown-first"],
          [".document-editor-block", "render(document.source)", "render(document.source)", "render(source)"],
          [".document-editor-block", "The relationship", "The relationship", "The equation relationship"],
          [".editor-media-caption", "representative workflow diagram", "representative workflow diagram", "sample workflow diagram"]
        ]
      }
    ]

    fixtures.each do |fixture|
      baseline = Documents::SampleData::SAMPLES.find { |sample| sample[:id] == fixture[:id] }.fetch(:source)
      visual = Document.create!(title: "Visual #{fixture[:id]}", source: baseline)
      expected = baseline.dup

      visit edit_document_path(visual)
      fixture[:operations].each do |selector, visible_text, source_text, replacement|
        type_visual_text(selector, visible_text, replacement)
        expected.sub!(source_text, replacement)
        assert_field "Markdown source", with: expected, wait: 5
        page.execute_script("document.activeElement.blur()")
        assert_selector selector, text: /#{Regexp.escape(replacement)}/, wait: 5
      end

      click_on "Save document"
      assert_selector ".flash.notice", text: "Document saved.", wait: 10
      assert_field "Markdown source", with: expected
      visual_source = visual.reload.source.gsub(/\r\n?/, "\n")
      visual.destroy!

      source = Document.create!(title: "Source #{fixture[:id]}", source: baseline)
      source_expected = baseline.dup
      visit edit_document_path(source)
      click_on "Source"
      fixture[:operations].each do |_selector, _visible_text, source_text, replacement|
        type_source_text(source_expected, source_text, replacement)
        source_expected.sub!(source_text, replacement)
        assert_field "Markdown source", with: source_expected, wait: 5
      end

      click_on "Save document"
      assert_selector ".flash.notice", text: "Document saved.", wait: 10
      assert_field "Markdown source", with: source_expected
      assert_equal expected, source_expected
      source_source = source.reload.source.gsub(/\r\n?/, "\n")
      assert_equal visual_source, source_source, "visual/source mismatch for #{fixture[:id]}"
    end
  end

  test "visual rich blocks preserve table and image Markdown while editing" do
    document = Document.create!(
      title: "Rich notes",
      source: "# Rich notes\n\n| Name | Value |\n| --- | --- |\n| **One** | Two |\n\n![Old alt](/icon.svg)"
    )

    visit edit_document_path(document)

    assert_selector ".document-editor-block table"
    assert_selector ".document-editor-block .editor-media-caption", text: "Old alt"

    page.execute_script(<<~JAVASCRIPT)
      const tableBlock = [...document.querySelectorAll('.document-editor-block')]
        .find((block) => block.querySelector('table'));
      tableBlock.focus();
      tableBlock.querySelector('tbody td:last-child').innerText = 'Updated';
      tableBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Updated' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /\| \*\*One\*\* \| Updated \|/, wait: 5
    assert_includes find_field("Markdown source").value, "![Old alt](/icon.svg)"
    page.execute_script("document.activeElement.blur()")
    assert_selector ".document-editor-block table", text: "Updated", wait: 5
    assert_no_selector 'form[data-preview-projection-stale="true"]', wait: 5

    page.execute_script(<<~JAVASCRIPT)
      const imageBlock = [...document.querySelectorAll('.document-editor-block')]
        .find((block) => block.querySelector('.editor-media-caption'));
      imageBlock.focus();
      const caption = imageBlock.querySelector('.editor-media-caption');
      caption.innerText = 'New alt';
      caption.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'New alt' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /!\[New alt\]\(\/icon\.svg\)/, wait: 5
    assert_includes find_field("Markdown source").value, "| **One** | Updated |"
  end

  test "visual inline edits preserve surrounding Markdown syntax" do
    document = Document.create!(
      title: "Inline notes",
      source: "# Inline notes\n\nA **bold** and *italic* link [target](/path)."
    )

    visit edit_document_path(document)

    page.execute_script(<<~JAVASCRIPT)
      const block = [...document.querySelectorAll('.document-editor-block')]
        .find((candidate) => candidate.querySelector('strong'));
      block.querySelector('strong').innerText = 'updated';
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'updated' }));
    JAVASCRIPT

    assert_field "Markdown source", with: "# Inline notes\n\nA **updated** and *italic* link [target](/path).", wait: 5
  end

  test "visual heading edits preserve inline formatting" do
    document = Document.create!(title: "Styled heading", source: "# **Styled** and *clear*")

    visit edit_document_path(document)
    page.execute_script(<<~JAVASCRIPT)
      const heading = document.querySelector('.document-editor-block strong');
      heading.textContent = 'Updated';
      heading.closest('.document-editor-block').dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Updated' }));
    JAVASCRIPT

    assert_field "Markdown source", with: "# **Updated** and *clear*", wait: 5
  end

  test "visual paragraph edits preserve inline and display LaTeX source" do
    source = 'Before $\\frac{a}{b}$ between $$\\sum_{i=1}^{n} i$$ after.'
    document = Document.create!(title: "Math preservation", source: source)

    visit edit_document_path(document)
    assert_selector '.document-editor-block [data-editor-math-source][contenteditable="false"]', count: 2

    page.execute_script(<<~JAVASCRIPT)
      const block = document.querySelector('.document-editor-block');
      block.focus();
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && !node.textContent.includes('Before ')) {}
      node.textContent = node.textContent.replace('Before ', 'Earlier ');
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Earlier' }));
    JAVASCRIPT
    assert_field "Markdown source", with: 'Earlier $\\frac{a}{b}$ between $$\\sum_{i=1}^{n} i$$ after.', wait: 5
    page.execute_script("document.activeElement.blur()")
    wait_for_fresh_projection

    page.execute_script(<<~JAVASCRIPT)
      const block = document.querySelector('.document-editor-block');
      block.focus();
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && !node.textContent.includes(' after.')) {}
      node.textContent = node.textContent.replace(' after.', ' still here.');
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'still here' }));
    JAVASCRIPT
    assert_field "Markdown source", with: 'Earlier $\\frac{a}{b}$ between $$\\sum_{i=1}^{n} i$$ still here.', wait: 5
  end

  test "new inline math renders while the visual document block stays focused" do
    document = Document.create!(title: "Inline math typing", source: "# Math\n\nAn equation")

    visit edit_document_path(document)
    block = find(".document-editor-block", text: "An equation")
    block.click
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      const range = document.createRange();
      range.selectNodeContents(block);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    JAVASCRIPT
    block.send_keys(" $test$")

    assert_field "Markdown source", with: "# Math\n\nAn equation $test$", wait: 5
    assert_selector ".document-editor-block .katex", text: "test", wait: 5
    block.send_keys(" after")
    assert_field "Markdown source", with: "# Math\n\nAn equation $test$ after", wait: 5

    click_on "Save document"
    assert_text "Document saved."
    visit edit_document_path(document)
    assert_field "Markdown source", with: "# Math\n\nAn equation $test$ after"
    assert_selector ".document-editor-block .katex", text: "test"
  end

  test "latex visual mode enter and exit flow allows inline editing" do
    visit new_document_path

    find(".document-editor-block h1", text: "Untitled document").send_keys(:enter)
    block = active_document_block
    block.send_keys("$x=3$")
    assert_selector ".document-editor-block .katex", wait: 5

    # 4. Hit left arrow -> enters math mode, de-renders to raw text with $ delimiters visible, caret is inside $x=3|$
    block.send_keys(:left)
    assert_selector ".document-editor-block .editor-math-active", text: "$x=3$", wait: 5

    # 5. Hit backspace -> deletes 3 -> $x=|$
    block.send_keys(:backspace)
    assert_selector ".document-editor-block .editor-math-active", text: "$x=$", wait: 5

    # 6. Hit 4 -> types 4 -> $x=4|$
    block.send_keys("4")
    assert_selector ".document-editor-block .editor-math-active", text: "$x=4$", wait: 5

    # 7. Hit right arrow -> leaves math block; re-renders KaTeX; caret is outside $x=4$|
    block.send_keys(:right)
    assert_selector ".document-editor-block [data-editor-math-source='x=4']", wait: 5
    assert_no_selector ".document-editor-block .editor-math-active"

    # 8. Hit left arrow -> de-renders to raw text; caret inside $x=4|$
    block.send_keys(:left)
    assert_selector ".document-editor-block .editor-math-active", text: "$x=4$", wait: 5

    # 9. Hit left arrow 2x -> caret moves past 4 and = -> $x|=4$
    block.send_keys(:left, :left)

    # 10. Hit backspace -> deletes x -> $|=4$
    block.send_keys(:backspace)
    assert_selector ".document-editor-block .editor-math-active", text: "$=4$", wait: 5

    # 11. Hit y -> types y -> $y|=4$
    block.send_keys("y")
    assert_selector ".document-editor-block .editor-math-active", text: "$y=4$", wait: 5

    # 12. Hit left arrow 2x -> 1st moves to $[caret]y=4$, 2nd moves past opening $ exiting math -> re-renders KaTeX
    block.send_keys(:left, :left)

    # 13. Success: Latex renders correctly and caret is outside |$y=4
    assert_selector ".document-editor-block [data-editor-math-source='y=4']", wait: 5
    assert_no_selector ".document-editor-block .editor-math-active"
    assert_field "Markdown source", with: "# Untitled document\n\n$y=4$", wait: 5
  end

  test "display latex visual mode enter and exit and click to edit" do
    visit new_document_path

    find(".document-editor-block h1", text: "Untitled document").send_keys(:enter)
    block = active_document_block
    block.send_keys("$$a=1$$")
    assert_selector ".document-editor-block .editor-live-math-display", wait: 5

    # Left arrow enters display math at $$a=1|$$
    block.send_keys(:left)
    assert_selector ".document-editor-block .editor-math-active", text: "$$a=1$$", wait: 5

    # Edit 1 -> 2
    block.send_keys(:backspace)
    block.send_keys("2")
    assert_selector ".document-editor-block .editor-math-active", text: "$$a=2$$", wait: 5

    # Right arrow leaves display math -> re-renders
    block.send_keys(:right)
    assert_selector ".document-editor-block [data-editor-math-source='a=2']", wait: 5
    assert_no_selector ".document-editor-block .editor-math-active"
    assert_field "Markdown source", with: "# Untitled document\n\n$$a=2$$", wait: 5

    # Click on the rendered KaTeX math element -> de-renders to active math
    find(".document-editor-block [data-editor-math-source='a=2']").click
    assert_selector ".document-editor-block .editor-math-active", text: "$$a=2$$", wait: 5

    # Blur by clicking title -> re-renders
    find(".document-editor-block h1").click
    assert_selector ".document-editor-block [data-editor-math-source='a=2']", wait: 5
    assert_no_selector ".document-editor-block .editor-math-active"
  end

  test "new document renders inline and display math before its first save" do
    visit new_document_path

    find(".document-editor-block h1", text: "Untitled document").send_keys(:enter)
    block = find(".document-editor-block[data-editor-empty-block='true']")
    block.click
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      const range = document.createRange();
      range.selectNodeContents(block);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    JAVASCRIPT
    block.send_keys(" $\\bar{x}$ and $$x^2$$ and \\(\\bar{y}\\) and \\[y^2\\]")

    assert_includes find_field("Markdown source").value, "$\\bar{x}$ and $$x^2$$ and \\(\\bar{y}\\) and \\[y^2\\]"
    assert_selector ".document-editor-block .katex", minimum: 4, wait: 5
    assert_selector ".document-editor-block .katex-display", minimum: 2
    assert_no_selector ".document-editor-block .math-error"

    page.execute_script("document.activeElement.blur()")
    assert_selector ".document-editor-block .katex-display", minimum: 1, wait: 5
    assert_no_selector ".preview-warnings li", text: /preview could not be rendered/i
  end

  test "new document source mode renders inline and display math before its first save" do
    visit new_document_path
    click_on "Source"

    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    find(".cm-content").send_keys("\n\n$\\bar{x}$ and \\(\\bar{y}\\)\n\n$$x^2$$\n\n\\[y^2\\]")

    assert_includes find_field("Markdown source").value, "$\\bar{x}$ and \\(\\bar{y}\\)\n\n$$x^2$$\n\n\\[y^2\\]"
    assert_selector ".preview-pane .katex", minimum: 4, wait: 5
    assert_selector ".preview-pane .katex-display", minimum: 2
    assert_no_selector ".preview-pane .math-error"
  end

  test "document preview renders inline accents and multiline display equations" do
    document = Document.create!(title: "Document math rendering", source: <<~MARKDOWN)
      # Math

      Inline $\\bar{x}$.

      $$
      \\begin{aligned}
      x &= y \\\\
      y &= z
      \\end{aligned}
      $$
    MARKDOWN

    visit edit_document_path(document)

    assert_selector ".document-editor-block .katex", count: 2
    assert_selector ".document-editor-block .katex-display", count: 1
    assert_no_selector ".document-editor-block .math-error"
  end

  test "visual paragraph edits preserve inline media source" do
    document = Document.create!(title: "Inline image", source: "Before ![diagram](/diagram.svg) after.")

    visit edit_document_path(document)
    assert_selector '.document-editor-block [data-editor-image-source][contenteditable="false"]'
    page.execute_script(<<~JAVASCRIPT)
      const block = document.querySelector('.document-editor-block');
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && !node.textContent.includes('Before ')) {}
      node.textContent = node.textContent.replace('Before ', 'Earlier ');
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Earlier' }));
    JAVASCRIPT

    assert_field "Markdown source", with: "Earlier ![diagram](/diagram.svg) after.", wait: 5
  end

  test "a new document uploads and displays an attached image before its first manual save" do
    visit new_document_path
    media_file = Tempfile.new(["document-pixel", ".png"])
    media_file.binmode
    media_file.write(Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="))
    media_file.flush

    page.execute_script("window.mediaPickerClicks = 0; document.querySelector('[data-media-target=input]').click = () => { window.mediaPickerClicks++ }")
    click_on "Add image"
    assert_equal 1, page.evaluate_script("window.mediaPickerClicks")
    page.execute_script("document.querySelector('[data-media-target=input]').hidden = false")
    find('[data-media-target="input"]').set(media_file.path)

    assert_selector ".media-upload-status", text: /document-pixel.*added to the Markdown source/i, wait: 8
    assert_includes find_field("Markdown source").value, "elef-asset:"
    assert_selector ".preview-pane img.presentation-media", wait: 8
    natural_width = page.evaluate_script("document.querySelector('.preview-pane img.presentation-media').naturalWidth")
    assert_operator natural_width, :>, 0


    document = Document.order(:id).last
    assert document.assets.attached?
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 8
    assert_includes document.reload.source, "elef-asset:"
  ensure
    media_file&.close!
  end

  test "visual edits preserve nested task lists and untouched item formatting" do
    source = "- [ ] Keep **this**\n  - Nested [link](/path)\n- [x] Already done"
    document = Document.create!(title: "List preservation", source: source)

    visit edit_document_path(document)
    page.execute_script(<<~JAVASCRIPT)
      const strong = document.querySelector('.document-editor-block strong');
      strong.textContent = 'that';
      strong.closest('.document-editor-block').dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'that' }));
    JAVASCRIPT

    assert_field "Markdown source", with: "- [ ] Keep **that**\n  - Nested [link](/path)\n- [x] Already done", wait: 5
  end

  test "visual code editing preserves fenced language and indentation" do
    document = Document.create!(
      title: "Code notes",
      source: "# Code\n\n```ruby\n  records.each do |record|\n    process(record)\n  end\n````"
    )

    visit edit_document_path(document)

    page.execute_script(<<~JAVASCRIPT)
      const codeBlock = [...document.querySelectorAll('.document-editor-block')]
        .find((block) => block.querySelector('pre'));
      codeBlock.querySelector('code').innerText = '  updated\\n    indented';
      codeBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'updated' }));
    JAVASCRIPT

    assert_field "Markdown source", with: "# Code\n\n```ruby\n  updated\n    indented\n````", wait: 5
  end

  test "keeps an unterminated fenced block read-only and preserves it across save and reopen" do
    source = "# Code notes\n\n```ruby\nputs 1"
    document = Document.create!(title: "Unterminated code", source: source)

    visit edit_document_path(document)

    assert_selector '.document-editor-block[aria-readonly="true"] pre code', text: "puts 1"
    assert_no_selector '.document-editor-block[contenteditable="true"] pre'
    page.execute_script(<<~JAVASCRIPT)
      const block = document.querySelector('.document-editor-block[aria-readonly="true"]');
      block.textContent = 'flattened code';
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'flattened code' }));
    JAVASCRIPT

    assert_field "Markdown source", with: source
    click_on "Save document"
    assert_text "Document saved."
    visit edit_document_path(document)

    assert_field "Markdown source", with: source
    assert_selector '.document-editor-block[aria-readonly="true"] pre code', text: "puts 1"
  end

  test "keeps reference links, autolinks, HTML, and rules read-only through save and reopen" do
    source = "[Guide][guide]\n\n[guide]: /guide\n\n<https://example.test>\n\n<kbd>Shift</kbd>\n\nfoo*bar*baz and value_name_value\n\n> outer\n> > nested quote\n\n| A |\n| --- |\n\n---"
    document = Document.create!(title: "Unsupported Markdown", source: source)

    visit edit_document_path(document)

    assert_selector '.document-editor-block[aria-readonly="true"]', minimum: 8, visible: false
    assert_selector '.document-editor-block[aria-readonly="true"] blockquote', text: "nested quote"
    assert_no_selector '.document-editor-block[contenteditable="true"]'
    page.execute_script(<<~JAVASCRIPT)
      document.querySelectorAll('.document-editor-block[aria-readonly="true"]').forEach((block) => {
        block.textContent = 'flattened output';
        block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'flattened output' }));
      });
    JAVASCRIPT

    assert_field "Markdown source", with: source
    click_on "Save document"
    assert_text "Document saved."
    visit edit_document_path(document)

    assert_field "Markdown source", with: source
    assert_selector '.document-editor-block[aria-readonly="true"]', minimum: 8, visible: false
  end

  test "expands math shorthand only when committed inside math" do
    document = Document.create!(title: "Math notes", source: "# Math")
    visit edit_document_path(document)
    editor = find_field("Markdown source")
    editor.click
    editor.send_keys(:end)
    editor.send_keys("\n$x.hat.b.T")
    editor.send_keys(:enter)

    assert_includes editor.value, "$\\mathbf{\\hat{x}}^{\\mathsf{T}}"
    assert_includes editor.value, "\n"
    assert_selector '[data-autosave-target="status"]', text: "Saved", wait: 5
  end

  test "wraps TeX commands with math modifiers for Greek letters and operators" do
    document = Document.create!(title: "TeX command modifiers", source: "# Math")
    visit edit_document_path(document)
    editor = find_field("Markdown source")
    editor.click
    editor.send_keys(:end)

    editor.send_keys("\n$\\chi.bar")
    editor.send_keys(:enter)
    assert_includes editor.value, "$\\bar{\\chi}"

    editor.send_keys("$\n$\\alpha.hat")
    editor.send_keys(:tab)
    assert_includes editor.value, "$\\hat{\\alpha}"

    editor.send_keys("$\n$\\beta.tilde")
    editor.send_keys(:enter)
    assert_includes editor.value, "$\\tilde{\\beta}"

    greek_commands = %w[
      alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi
      pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega
      Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
    ]
    editor.send_keys("$\n$")
    greek_commands.each do |command|
      editor.send_keys(" \\#{command}.bar")
      editor.send_keys(:enter)
      editor.send_keys(" ")
    end
    editor.send_keys("$")

    greek_commands.each do |command|
      assert_includes editor.value, "\\bar{\\#{command}}", "\\#{command} should be wrapped as a TeX command"
    end

    editor.send_keys("\n$\\nabla.vec")
    editor.send_keys(:enter)
    assert_includes editor.value, "$\\vec{\\nabla}", "operators should also be wrapped as TeX commands"
  end

  test "chains supported math modifiers and leaves conflicting chains intact" do
    document = Document.create!(title: "Math modifier chains", source: "# Math")
    visit edit_document_path(document)
    editor = find_field("Markdown source")
    editor.click
    editor.send_keys(:end)
    expanded = ->(symbol) { "$\\mathbf{\\bar{#{symbol}}}$" }

    editor.send_keys("\n$x.bar")
    editor.send_keys(:enter)
    editor.send_keys(".bb")
    editor.send_keys(:enter)
    editor.send_keys("$")
    assert_includes editor.value, expanded.call("x"), "bar then bold should compose across commits: #{editor.value.inspect}"

    editor.send_keys("\n$y.bar.bb")
    editor.send_keys(:enter)
    editor.send_keys("$")
    assert_includes editor.value, expanded.call("y"), "bar then bold should compose in one token: #{editor.value.inspect}"

    editor.send_keys("\n$z.bb.bar")
    editor.send_keys(:enter)
    editor.send_keys("$")
    assert_includes editor.value, expanded.call("z"), "bold then bar should compose in one token: #{editor.value.inspect}"

    editor.send_keys("\n$w.bb")
    editor.send_keys(:enter)
    editor.send_keys(".bar")
    editor.send_keys(:enter)
    editor.send_keys("$")
    assert_includes editor.value, expanded.call("w"), "bold then bar should compose across commits: #{editor.value.inspect}"

    assert_equal ["x", "y", "z", "w"].map { |symbol| expanded.call(symbol) }.length,
      ["x", "y", "z", "w"].sum { |symbol| editor.value.scan(expanded.call(symbol)).length }

    editor.send_keys("\n$v.bar")
    editor.send_keys(:enter)
    editor.send_keys(".hat")
    editor.send_keys(:enter)
    assert_includes editor.value, "$\\bar{v}.hat\n", "conflicting modifiers across commits should stay literal: #{editor.value.inspect}"
    editor.send_keys("$")

    ["x.bb.bb", "x.bar.bar", "x.bar.hat"].each do |token|
      editor.send_keys("\n$#{token}")
      editor.send_keys(:enter)
      assert_includes editor.value, "$#{token}\n"
      editor.send_keys("$")
    end
  end

  test "canonicalizes modifier order and ignores code and unknown contexts" do
    document = Document.create!(title: "Math contexts", source: "# Math")
    visit edit_document_path(document)
    editor = find_field("Markdown source")
    source = "# Math\n\nOutside x.hat.b\n\n```\n$x.hat.b\n```\n\n$x.T.b.hat\n\n$x.unknown"
    page.execute_script(<<~JAVASCRIPT, source)
      const editor = document.querySelector('textarea[name="document[source]"]');
      editor.value = arguments[0];
      editor.focus();
      editor.setSelectionRange(editor.value.indexOf("\\n\\n$x.unknown"), editor.value.indexOf("\\n\\n$x.unknown"));
    JAVASCRIPT
    editor.send_keys(:tab)

    assert_includes editor.value, "Outside x.hat.b"
    assert_includes editor.value, "\n$x.hat.b\n```"
    assert_includes editor.value, "$\\mathbf{\\hat{x}}^{\\mathsf{T}}"

    page.execute_script("const editor = document.querySelector('textarea[name=\"document[source]\"]'); editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length);")
    editor.send_keys(:enter)
    assert_includes editor.value, "$x.unknown\n"
  end

  test "keeps the last good preview when a live preview fails" do
    document = Document.create!(title: "Stable notes", source: "# Stable notes\n\nLast good content")
    visit edit_document_path(document)
    assert_selector ".document-surface", text: "Last good content"

    page.execute_script(<<~JAVASCRIPT)
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === "POST" && String(url).includes("/preview")) {
          window.fetch = originalFetch;
          return Promise.resolve(new Response(JSON.stringify({
            html: null,
            warnings: ["The preview service rejected this edit."],
            revision: "failed-preview"
          }), { status: 422, headers: { "Content-Type": "application/json" } }));
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# Broken edit"
    assert_selector '[data-preview-target="status"]', text: "Preview unavailable", wait: 5
    assert_selector '[data-preview-target="warnings"]', text: "The preview service rejected this edit."
    assert_selector ".document-surface", text: "Last good content"
    assert_no_selector ".document-surface", text: "Broken edit"
    assert_selector '[data-preview-target="retry"]', visible: true

    click_on "Retry preview"
    assert_selector ".document-surface", text: "Broken edit", wait: 5
    assert_selector '[data-preview-target="warnings"]', visible: false
    assert_selector '[data-preview-target="retry"]', visible: false
  end

  test "disables a stale document projection when returning from source mode before preview recovery" do
    original = "# Original\n\nOld first block\n\nOld second block"
    updated = "# Rebuilt\n\nNew first block\n\nNew second block"
    document = Document.create!(title: "Stale projection", source: original)

    visit edit_document_path(document)
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT, updated)
      const form = document.querySelector('form.visual-editor-form');
      form.previewController.delayValue = 5000;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === 'POST' && String(url).includes('/preview')) {
          return Promise.reject(new TypeError('preview offline'));
        }
        return originalFetch(url, options);
      };
      document.querySelector('.source-field').editorController.setExternalValue(arguments[0]);
    JAVASCRIPT
    click_on "Visual"

    assert_selector ".editor-projection", visible: true
    assert_selector ".editor-projection", text: "Old first block"
    assert_selector '.editor-projection[aria-busy="true"]'
    assert_no_selector '.editor-projection .document-editor-block[contenteditable="true"]'
    assert_field "Markdown source", with: updated

    page.execute_script(<<~JAVASCRIPT)
      const form = document.querySelector('form.visual-editor-form');
      form.previewController.delayValue = 0;
      form.previewController.retry();
    JAVASCRIPT
    assert_selector '[data-preview-target="status"]', text: "Preview unavailable", wait: 5
    assert_selector ".editor-projection", text: "Old first block"
    assert_selector '.editor-projection[aria-busy="false"]'
    assert_no_selector '.editor-projection .document-editor-block[contenteditable="true"]'

    page.execute_script(<<~JAVASCRIPT)
      const staleBlock = document.querySelector('.editor-projection .document-editor-block');
      staleBlock.textContent = 'Stale-map injection';
      staleBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Stale-map injection' }));
    JAVASCRIPT
    assert_field "Markdown source", with: updated

    click_on "Save document"
    assert_text "Document saved."
    visit edit_document_path(document)
    assert_field "Markdown source", with: updated
    assert_selector ".document-editor-block", text: "New first block"
  end

  test "keeps typing enabled when the local projection reports a failure" do
    document = Document.create!(title: "Projection notes", source: "# Stable")
    visit edit_document_path(document)

    page.execute_script(<<~JAVASCRIPT)
      document.querySelector('.source-field').dispatchEvent(new CustomEvent('elef:live-preview-error', {
        bubbles: true,
        detail: { message: 'Live projection unavailable for this edit.' }
      }));
    JAVASCRIPT

    assert_selector '[data-preview-target="warnings"]', text: "Live projection unavailable for this edit."
    fill_in "Markdown source", with: "# Still editable"
    assert_field "Markdown source", with: "# Still editable"
  end

  test "keeps typing responsive while preview is stalled and preserves the last good result" do
    document = Document.create!(title: "Slow notes", source: "# Stable content")
    visit edit_document_path(document)

    page.execute_script(<<~JAVASCRIPT)
      const form = document.querySelector('form.visual-editor-form');
      form.previewController.timeoutValue = 1200;
      window.previewStarted = false;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === 'POST' && String(url).includes('/preview')) {
          window.previewStarted = true;
          return new Promise(() => {});
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# First slow edit"
    preview_started = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const deadline = Date.now() + 5000;
      const waitForPreview = () => {
        if (window.previewStarted) return done(true);
        if (Date.now() >= deadline) return done(false);
        window.setTimeout(waitForPreview, 10);
      };
      waitForPreview();
    JAVASCRIPT
    assert preview_started, "preview request did not start"

    fill_in "Markdown source", with: "# Latest slow edit"
    assert_field "Markdown source", with: "# Latest slow edit"
    assert_selector '[data-preview-target="status"]', text: "Preview unavailable", wait: 5
    assert_selector '[data-preview-target="warnings"]', text: "Preview timed out."
    assert_selector ".document-surface", text: "Stable content"
    assert_no_selector ".document-surface", text: "Latest slow edit"
    assert_selector '[data-preview-target="retry"]', visible: true
  end

  test "debounces rapid preview requests and renders the latest source" do
    document = Document.create!(title: "Latency notes", source: "# Initial")
    visit edit_document_path(document)

    page.execute_script(<<~JAVASCRIPT)
      window.previewRequests = 0;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === "POST" && String(url).includes("/preview")) window.previewRequests += 1;
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# First draft"
    fill_in "Markdown source", with: "# Latest draft"

    assert_selector ".document-surface h1", text: "Latest draft", wait: 5
    assert_equal 1, page.evaluate_script("window.previewRequests")
  end

  test "ignores a slow preview response after a newer edit" do
    document = Document.create!(title: "Race notes", source: "# Initial")
    visit edit_document_path(document)

    page.execute_script(<<~JAVASCRIPT)
      window.previewResponses = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === "POST" && String(url).includes("/preview")) {
          const source = options.body.get("document[source]");
          return new Promise((resolve) => window.previewResponses.push({ source, resolve }));
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# First response"
    wait_for_preview_response(1)
    assert_equal 1, page.evaluate_script("window.previewResponses.length")

    fill_in "Markdown source", with: "# Latest response"
    wait_for_preview_response(2)
    assert_equal 2, page.evaluate_script("window.previewResponses.length")

    page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const response = window.previewResponses[0];
      const title = response.source.match(/^# (.*)$/m)[1];
      response.resolve(new Response(JSON.stringify({
        html: `<div class="document-reader"><div class="document-surface"><h1>${title}</h1></div></div>`,
        warnings: [],
        editor_map: null
      }), { headers: { "Content-Type": "application/json" } }));
      window.setTimeout(done, 20);
    JAVASCRIPT
    assert_no_selector ".document-surface h1", text: "First response"

    page.execute_script(<<~JAVASCRIPT)
      const response = window.previewResponses[1];
      const title = response.source.match(/^# (.*)$/m)[1];
      response.resolve(new Response(JSON.stringify({
        html: `<div class="document-reader"><div class="document-surface"><h1>${title}</h1></div></div>`,
        warnings: [],
        editor_map: null
      }), { headers: { "Content-Type": "application/json" } }));
    JAVASCRIPT
    assert_selector ".document-surface h1", text: "Latest response", wait: 5
  end

  test "paginates long documents and gives headings a clear hierarchy" do
    report = Documents::SampleData.load!.records.find { |record| record.sample_id == "document-full-report" }

    visit document_path(report)

    assert_selector ".document-surface.is-paginated"
    assert_selector ".document-page", minimum: 2, wait: 5
    assert_text "Appendix C: Glossary"

    page_count = page.evaluate_script("document.querySelectorAll('.document-page').length")
    assert_operator page_count, :>=, 2
    assert_selector ".document-page-number", text: /Page 1 of #{page_count}/i

    font_sizes = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const surface = document.querySelector('.document-surface');
        const size = (selector) => Number.parseFloat(getComputedStyle(surface.querySelector(selector)).fontSize);
        return { body: size('p'), h1: size('h1'), h2: size('h2') };
      })()
    JAVASCRIPT
    assert_operator font_sizes["h1"], :>, font_sizes["body"]
    assert_operator font_sizes["h2"], :>, font_sizes["body"]
    assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=, page.evaluate_script("window.innerWidth")

    page.driver.browser.manage.window.resize_to(600, 900)
    assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=, page.evaluate_script("window.innerWidth")
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "horizontal-only document positions stay content-sized" do
    document = Document.create!(
      title: "Inline positions",
      source: <<~MARKDOWN
        :::position{left}

        Left stays ordinary.

        :::position{center}

        Center stays ordinary.

        :::position{right}

        Right stays ordinary.
      MARKDOWN
    )

    visit document_path(document)

    heights = page.evaluate_script("[...document.querySelectorAll('.document-block')].map((block) => block.getBoundingClientRect().height)")
    assert_equal 3, heights.length
    assert heights.all? { |height| height < 120 }, "horizontal-only blocks should not become vertical stages: #{heights.inspect}"
  end

  test "positions document blocks visually and preserves directives across source mode" do
    source = "# Alignment\n\nLeft block\n\n:::position{center middle}\n\nCentered block"
    document = Document.create!(title: "Block alignment", source: source)
    visit edit_document_path(document)
    wait_for_fresh_projection

    left = find(".document-editor-block", text: "Left block")
    left_id = left["data-editor-block-id"]
    left.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{left_id}']").select("Right")

    assert_field "Markdown source", with: /:::position\{right\}\n\nLeft block/, wait: 5
    right_aligned = find(".document-editor-block.position-right", text: "Left block", wait: 5)
    assert_equal left_id, right_aligned["data-editor-block-id"]
    assert_equal left_id, page.evaluate_script("document.activeElement?.dataset.editorBlockId")
    assert_equal "right", page.evaluate_script("getComputedStyle(arguments[0]).textAlign", right_aligned)
    type_visual_text(".document-editor-block", "Left block", "Updated left block")
    assert_field "Markdown source", with: /:::position\{right\}\n\nUpdated left block/, wait: 5
    page.execute_script("document.activeElement.blur()")
    wait_for_fresh_projection

    centered = find(".document-editor-block", text: "Centered block")
    assert_includes centered["class"], "position-center"
    assert_equal "center", page.evaluate_script("getComputedStyle(arguments[0]).textAlign", centered)
    centered.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    centered_control = find("[data-visual-editor-block-id='#{centered['data-editor-block-id']}']")
    centered_control.select("Right")

    assert_field "Markdown source", with: /:::position\{right middle\}/, wait: 5
    assert_selector ".document-editor-block.position-right", text: "Centered block", wait: 5
    right_aligned = find(".document-editor-block.position-right", text: "Centered block")
    assert_equal "right", page.evaluate_script("getComputedStyle(arguments[0]).textAlign", right_aligned)
    right_aligned.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{right_aligned['data-editor-block-id']}']").select("Left")
    assert_field "Markdown source", with: /:::position\{left middle\}/, wait: 5
    left_aligned = find(".document-editor-block.position-left", text: "Centered block", wait: 5)
    assert_equal "left", page.evaluate_script("getComputedStyle(arguments[0]).textAlign", left_aligned)
    centered_id = left_aligned["data-editor-block-id"]
    left_aligned.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{centered_id}']").select("Automatic position")
    wait_for_fresh_projection
    refute_match(/:::position\{left middle\}/, find_field("Markdown source").value)
    assert_equal "", find("[data-visual-editor-block-id='#{centered_id}']").value

    click_on "Source"
    assert_field "Markdown source", with: /:::position\{right\}\n\nUpdated left block/
    click_on "Visual"
    wait_for_fresh_projection

    centered = find(".document-editor-block", text: "Centered block")
    refute_includes centered["class"], "position-left"
    centered.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    assert_equal "", find("[data-visual-editor-block-id='#{centered['data-editor-block-id']}']").value
    type_visual_text(".document-editor-block", "Centered block", "Updated centered block")
    assert_field "Markdown source", with: /:::position\{right\}\n\nUpdated left block\n\nUpdated centered block/, wait: 5
    refute_includes find(".editor-projection").text, ":::position"
  end

  test "positions the first document block when no source content precedes it" do
    document = Document.create!(title: "First block alignment", source: "Test")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Test")
    block_id = block["data-editor-block-id"]
    block.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{block_id}']").select("Left")

    assert_field "Markdown source", with: /\A:::position\{left\}\n\nTest\z/, wait: 5

    find(".document-editor-block[data-editor-block-id='#{block_id}']").find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{block_id}']").select("Center")

    assert_field "Markdown source", with: /\A:::position\{center\}\n\nTest\z/, wait: 5

    find(".document-editor-block[data-editor-block-id='#{block_id}']").find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{block_id}']").select("Right")
    assert_field "Markdown source", with: /\A:::position\{right\}\n\nTest\z/, wait: 5
  end

  test "changes a position directive on the first document block" do
    document = Document.create!(title: "Change first block alignment", source: ":::position{right}\n\nTest")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Test")
    block_id = block["data-editor-block-id"]
    block.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{block_id}']").select("Center")

    assert_field "Markdown source", with: /\A:::position\{center\}\n\nTest\z/, wait: 5
  end

  test "changes a position directive added in source mode" do
    document = Document.create!(title: "Source mode alignment", source: "Test")
    visit edit_document_path(document)
    wait_for_fresh_projection

    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      document.querySelector(".source-field").editorController.replaceRange(":::position{right}\\n\\n", 0, 0)
    JAVASCRIPT
    assert_field "Markdown source", with: /\A:::position\{right\}\n\nTest\z/, wait: 5
    click_on "Visual"
    wait_for_fresh_projection
    assert_field "Markdown source", with: /\A:::position\{right\}\n\nTest\z/, wait: 5

    block = find(".document-editor-block", text: "Test")
    block_id = block["data-editor-block-id"]
    block.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{block_id}']").select("Center")

    assert_field "Markdown source", with: /\A:::position\{center\}\n\nTest\z/, wait: 5
  end

  test "deleting an empty positioned block also removes its position directive" do
    document = Document.create!(
      title: "Delete positioned block",
      source: "# Keep\n\n:::position{center}\n\nDelete me\n\nTail"
    )
    visit edit_document_path(document)

    block = find(".document-editor-block", text: "Delete me")
    removed = page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      block.innerHTML = "<p><br></p>";
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(block.querySelector("p"), 0);
      const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
      block.dispatchEvent(event);
      return event.defaultPrevented;
    JAVASCRIPT

    assert_equal true, removed
    assert_field "Markdown source", with: "# Keep\n\nTail", wait: 5
    refute_selector ".document-editor-block.position-center", text: "Tail"
  end

  test "deleting a single block in a grouped position removes its opening and closing directives" do
    source = "# Keep\n\n:::position{center}\n\nDelete me\n\n:::\n\nTail"
    map = Source::Document.editor_map(source, mode: :document)
    positioned = map[:slides].first[:blocks].find { |candidate| candidate[:markdown] == "Delete me" }
    assert_equal "group", positioned[:position_scope]

    document = Document.create!(title: "Delete grouped position", source: source)
    visit edit_document_path(document)

    block = find(".document-editor-block", text: "Delete me")
    removed = page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      block.innerHTML = "<p><br></p>";
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(block.querySelector("p"), 0);
      const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
      block.dispatchEvent(event);
      return event.defaultPrevented;
    JAVASCRIPT

    assert_equal true, removed
    assert_field "Markdown source", with: "# Keep\n\nTail", wait: 5
    refute_includes find_field("Markdown source").value, ":::"
  end

  test "maintains standard aspect ratio and fixed text wrapping across viewports" do
    document = Document.create!(
      title: "Aspect ratio document",
      source: <<~MARKDOWN
        # Standard Aspect Ratio Title

        This is a paragraph with several words designed to check that resizing the window or browser does not re-wrap any words.
      MARKDOWN
    )

    visit document_path(document)

    assert_selector ".document-page", count: 1
    page.driver.browser.manage.window.resize_to(1400, 1000)

    desktop_measurements = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const frame = document.querySelector('.document-page-frame');
        const page = document.querySelector('.document-page');
        const paragraph = page.querySelector('p');
        const frameRect = frame.getBoundingClientRect();
        return {
          frameAspect: frameRect.width / frameRect.height,
          pageWidth: page.offsetWidth,
          pageHeight: page.offsetHeight,
          paragraphLines: paragraph.getClientRects().length,
          paragraphText: paragraph.innerText
        };
      })()
    JAVASCRIPT

    assert_in_delta 816.0 / 1154.0, desktop_measurements["frameAspect"], 0.05
    assert_equal 816, desktop_measurements["pageWidth"]
    assert_equal 1154, desktop_measurements["pageHeight"]

    # Resize to mobile / tablet width (600px)
    page.driver.browser.manage.window.resize_to(600, 900)

    mobile_measurements = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const frame = document.querySelector('.document-page-frame');
        const page = document.querySelector('.document-page');
        const paragraph = page.querySelector('p');
        const frameRect = frame.getBoundingClientRect();
        return {
          frameAspect: frameRect.width / frameRect.height,
          pageWidth: page.offsetWidth,
          pageHeight: page.offsetHeight,
          paragraphLines: paragraph.getClientRects().length,
          paragraphText: paragraph.innerText
        };
      })()
    JAVASCRIPT

    assert_in_delta 816.0 / 1154.0, mobile_measurements["frameAspect"], 0.05
    assert_equal 816, mobile_measurements["pageWidth"]
    assert_equal 1154, mobile_measurements["pageHeight"]
    assert_equal desktop_measurements["paragraphLines"], mobile_measurements["paragraphLines"], "Text line count should not re-wrap when scaling"
    assert_equal desktop_measurements["paragraphText"], mobile_measurements["paragraphText"]
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "print view renders paginated document and triggers window.print" do
    document = Document.create!(
      title: "Printable Document",
      source: "# Page 1\n\nFirst page body\n\n---\n\n# Page 2\n\nSecond page body"
    )

    visit print_document_path(document)

    assert_text "Printable Document"
    assert_selector ".document-print-toolbar", text: /Printable Document/
    assert_selector ".document-page", minimum: 1

    page.execute_script("window.print = () => { window.printWasRequested = true }")
    click_on "Print / Save PDF"
    assert_equal true, page.evaluate_script("window.printWasRequested")
  end
end
