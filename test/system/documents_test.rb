Warning: truncated output (original token count: 20370)
Total output lines: 1729

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
    page.evaluate_async_script("requestAnimatio…8370 tokens truncated…ditor.value.length, editor.value.length);")
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
