require "application_system_test_case"

class DocumentsTest < ApplicationSystemTestCase
  def wait_for_fresh_projection
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 5
  end

  def wait_for_settled_document_projection
    wait_for_fresh_projection
    assert_selector ".document-editor-projection .document-surface[data-document-pages-settled='true']", wait: 10
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
    find(".document-editor-block[data-editor-block-id]:focus")
  end

  test "source mode inserts and continues Mermaid flowcharts with Enter and branching keys" do
    document = Document.create!(title: "Mermaid process", source: "# Existing text")

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
    source = find_field("Markdown source")
    assert_includes source.value, "```mermaid\nflowchart LR\n    A[]\n```"
    assert_equal "[]", page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        return editor.value.slice(editor.selectionStart - 1, editor.selectionStart + 1);
      })()
    JAVASCRIPT

    editor.send_keys("Research", :enter)
    assert_field "Markdown source", with: /A\[Research\] --> B\[\]/, wait: 5
    editor.send_keys("Design", :enter)
    assert_field "Markdown source", with: /A\[Research\] --> B\[Design\] --> C\[\]/, wait: 5

    editor.send_keys(:tab)
    assert_field "Markdown source", with: /C --> D\[\]/, wait: 5
    branch_source = source.value
    editor.send_keys(:shift, :tab)
    assert_equal branch_source, source.value
    assert_equal "C", page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        return editor.value[editor.selectionStart];
      })()
    JAVASCRIPT
    editor.send_keys(:shift, :tab)
    assert_includes source.value, "B[Design] --> C[]"
    assert_match(/\ADesign\]/, page.evaluate_script(<<~JAVASCRIPT))
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        return editor.value.slice(editor.selectionStart, editor.selectionStart + 7);
      })()
    JAVASCRIPT
    node_ids = source.value.scan(/\b([A-Z])(?=\[)/).flatten
    assert_equal node_ids.uniq, node_ids
  end

  test "source mode keeps /diagram keyboard navigation open through selection" do
    document = Document.create!(title: "Mermaid keyboard command", source: "# Existing text")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    editor.send_keys(:enter, "/diag")

    assert_selector ".mermaid-assist-option", text: "/diagram", wait: 5
    editor.send_keys(:enter)
    assert_selector ".mermaid-assist-option", text: "Flowchart / process", wait: 5
    assert_selector '[data-mermaid-assist-target="palette"]:not([hidden])'

    editor.send_keys(:arrow_down)
    assert_selector ".mermaid-assist-option[aria-selected='true']", text: "Sequence diagram"
    assert_selector '[data-mermaid-assist-target="palette"]:not([hidden])'
    editor.send_keys(:arrow_up)
    assert_selector ".mermaid-assist-option[aria-selected='true']", text: "Flowchart / process"
    assert_selector '[data-mermaid-assist-target="palette"]:not([hidden])'

    editor.send_keys(:arrow_down, :enter)
    assert_field "Markdown source", with: /sequenceDiagram/, wait: 5
    assert_no_selector '[data-mermaid-assist-target="palette"]:not([hidden])'
  end

  test "source mode accepts a Mermaid diagram type with Tab" do
    document = Document.create!(title: "Mermaid keyboard Tab", source: "# Existing text")

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
    editor.send_keys(:arrow_down)
    assert_selector ".mermaid-assist-option[aria-selected='true']", text: "Sequence diagram", wait: 5
    assert_selector '[data-mermaid-assist-target="palette"]:not([hidden])'

    editor.send_keys(:tab)
    assert_field "Markdown source", with: /sequenceDiagram/, wait: 5
    assert_no_selector '[data-mermaid-assist-target="palette"]:not([hidden])'
  end

  test "source mode dismisses Mermaid suggestions when the caret leaves their context" do
    document = Document.create!(title: "Mermaid stale suggestion", source: "# Existing text")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    editor.send_keys(:enter, "/diagram")
    assert_selector '[data-mermaid-assist-target="palette"]:not([hidden])', wait: 5

    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(0);
    JAVASCRIPT
    assert_no_selector '[data-mermaid-assist-target="palette"]:not([hidden])', wait: 5
  end

  test "Mermaid source assist restores keyboard listeners after Stimulus reconnects" do
    document = Document.create!(title: "Mermaid reconnect", source: "# Existing text")

    visit edit_document_path(document)
    click_on "Source"
    page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const root = document.querySelector('.source-field');
      const controllers = root.dataset.controller.split(/\\s+/);
      root.dataset.controller = controllers.filter((name) => name !== 'mermaid-assist').join(' ');
      setTimeout(() => {
        root.dataset.controller = controllers.join(' ');
        setTimeout(done, 50);
      }, 50);
    JAVASCRIPT

    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    assert_equal true, page.evaluate_script("window.Stimulus.getControllerForElementAndIdentifier(document.querySelector('.source-field'), 'mermaid-assist').keydownBound")
    editor.send_keys(:enter, "/diag")
    assert_selector ".mermaid-assist-option", text: "/diagram", wait: 5
    editor.send_keys(:enter)
    assert_selector ".mermaid-assist-option", text: "Flowchart / process", wait: 5
    editor.send_keys(:enter)
    assert_field "Markdown source", with: /flowchart LR/, wait: 5
  end

  test "Mermaid source assist ignores mutations after its editor view is destroyed" do
    source = "```mermaid\nflowchart LR\n    A[Research]\n```"
    document = Document.create!(title: "Mermaid editor teardown", source: source)

    visit edit_document_path(document)
    click_on "Source"
    results = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const root = document.querySelector('.source-field');
      const controllers = root.dataset.controller.split(/\\s+/);
      const editor = root.editorController;
      const assist = window.Stimulus.getControllerForElementAndIdentifier(root, 'mermaid-assist');
      root.dataset.controller = controllers.filter((name) => name !== 'editor').join(' ');
      setTimeout(() => {
        const original = editor.value;
        let noThrow = true;
        try {
          editor.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true, cancelable: true
          }));
          editor.setSelectionRange(0);
          editor.replaceRange('bad', 0, 0);
          editor.replaceRangeWithSelection('bad', 0, 0, { from: 0, to: 0 });
        } catch (_error) {
          noThrow = false;
        }
        const results = {
          noThrow,
          unchanged: editor.value === original,
          staleEditorDestroyed: editor.destroyed,
          assistRetargeted: assist.editorController === editor
        };
        root.dataset.controller = controllers.join(' ');
        setTimeout(() => done({ ...results, assistRetargetedAfterReconnect: assist.editorController === root.editorController }), 100);
      }, 100);
    JAVASCRIPT

    assert_equal({
      "noThrow" => true,
      "unchanged" => true,
      "staleEditorDestroyed" => true,
      "assistRetargeted" => true,
      "assistRetargetedAfterReconnect" => true
    }, results)
    assert page.evaluate_script("Boolean(document.querySelector('.source-field').editorController)")
  end

  test "document command palettes stay inactive inside Mermaid code" do
    source = "```mermaid\nflowchart LR\n    A[]\n```"
    document = Document.create!(title: "Mermaid palette context", source: source)

    visit edit_document_path(document)
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      const position = editor.value.indexOf('A[]') + 2;
      editor.setSelectionRange(position);
      editor.focus();
    JAVASCRIPT
    editor = find(".cm-content")
    editor.send_keys("/image")
    assert_no_selector ".snippet-option", text: /Image/
    assert_includes find_field("Markdown source").value, "A[/image]"
  end

  test "Mermaid Enter does not continue a diagram during IME composition" do
    source = "```mermaid\nflowchart LR\n    A[Research]\n```"
    document = Document.create!(title: "Mermaid IME composition", source: source)

    visit edit_document_path(document)
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      const caret = editor.value.indexOf('Research') + 'Research'.length;
      editor.setSelectionRange(caret);
      editor.focus();
      editor.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const event = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 229, which: 229,
        bubbles: true, cancelable: true, isComposing: true
      });
      editor.dom.dispatchEvent(event);
      editor.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    JAVASCRIPT
    refute_includes find_field("Markdown source").value, "--> B[]"
  end

  test "Mermaid suggestions stay dismissed during IME composition and refresh afterward" do
    document = Document.create!(title: "Mermaid IME suggestions", source: "# Existing text")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    editor.send_keys(:enter, "/diagram")
    assert_selector '[data-mermaid-assist-target="palette"]:not([hidden])', wait: 5

    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      editor.inputTarget.dispatchEvent(new Event('input', { bubbles: true }));
    JAVASCRIPT
    assert_no_selector '[data-mermaid-assist-target="palette"]:not([hidden])', wait: 5
    refute_includes find_field("Markdown source").value, "```mermaid"

    page.execute_script(<<~JAVASCRIPT)
      document.querySelector('.source-field').editorController.dom.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: '' })
      );
    JAVASCRIPT
    assert_selector '[data-mermaid-assist-target="palette"]:not([hidden])', wait: 5
  end

  test "CRLF Mermaid source keeps valid insertion positions" do
    source = "# Existing text\r\n\r\n```mermaid\r\nflowchart LR\r\n    A[Research]\r\n```"
    document = Document.create!(title: "Mermaid CRLF", source: source)

    visit edit_document_path(document)
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      const caret = editor.value.indexOf('Research') + 'Research'.length;
      editor.setSelectionRange(caret);
      editor.focus();
    JAVASCRIPT
    find(".cm-content").send_keys(:enter)
    assert_field "Markdown source", with: /A\[Research\] --> B\[\]/, wait: 5
  end

  test "mermaid continuation falls back safely when the caret is in the middle of a label" do
    source = "```mermaid\nflowchart LR\n    A[Research] --> B[Design]\n```"
    document = Document.create!(title: "Mermaid middle edit", source: source)

    visit edit_document_path(document)
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      const position = editor.value.indexOf('Research') + 3;
      editor.setSelectionRange(position);
      editor.focus();
    JAVASCRIPT
    find(".cm-content").send_keys(:enter)

    edited = find_field("Markdown source").value
    assert_match(/Res\s+earch\] --> B\[Design\]/, edited)
    refute_match(/--> C\[\]/, edited)
  end

  test "Mermaid autocomplete offers existing flowchart nodes when completing an edge" do
    source = "```mermaid\nflowchart LR\n    A[Research]\n    A --> \n```"
    document = Document.create!(title: "Mermaid node completion", source: source)

    visit edit_document_path(document)
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.indexOf('\\n```'));
      editor.focus();
    JAVASCRIPT
    editor = find(".cm-content")
    editor.send_keys("A")

    assert_selector ".mermaid-assist-option", text: "A", wait: 5
    editor.send_keys(:enter)
    assert_includes find_field("Markdown source").value, "A --> A\n```"
  end

  test "normal source Enter and snippet Tab completion remain available outside Mermaid" do
    Snippet.create!(name: "Two text fields", trigger: "pair", category: "Markdown", body: "${1:first} ${2:second}")
    document = Document.create!(title: "Ordinary source", source: "# Existing")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    editor.send_keys(:enter, "Plain text", :enter, "/pair")

    assert_selector ".snippet-option", text: "Two text fields", wait: 5
    assert_selector '[data-mermaid-assist-target="palette"]', visible: false
    editor.send_keys(:enter)
    source = find_field("Markdown source")
    assert_includes source.value, "Plain text\nfirst second"
    editor.send_keys(:tab)
    assert_equal "second", page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        return editor.value.slice(editor.selectionStart, editor.selectionEnd);
      })()
    JAVASCRIPT
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

    visit settings_path
    find("[data-vim-settings-target='vimToggle']").check
    visit edit_document_path(document)

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

  test "typing after clearing inline math stays inside the expression" do
    visit new_document_path

    find(".document-editor-block h1", text: "Untitled document").send_keys(:enter)
    block = active_document_block
    block.send_keys("$x$")
    assert_selector ".document-editor-block [data-editor-math-source='x']", wait: 5

    block.send_keys(:left)
    assert_selector ".document-editor-block .editor-math-active", text: "$x$", wait: 5
    block.send_keys(:backspace)
    assert_selector ".document-editor-block .editor-math-active", text: "$$", wait: 5
    block.send_keys("x=3")

    assert_selector ".document-editor-block .editor-math-active", text: "$x=3$", wait: 5
    assert_field "Markdown source", with: "# Untitled document\n\n$x=3$", wait: 5
  end

  test "typing after navigating into empty inline math stays inside the expression" do
    visit new_document_path

    find(".document-editor-block h1", text: "Untitled document").send_keys(:enter)
    block = active_document_block
    block.send_keys("$$")
    block.send_keys(:left)
    block.send_keys("x=3")
    assert_selector ".document-editor-block .editor-math-active", text: "$x=3$", wait: 5
    assert_field "Markdown source", with: "# Untitled document\n\n$x=3$", wait: 5
    block.send_keys(:enter)

    assert_field "Markdown source", with: "# Untitled document\n\n$x=3$\n\n", wait: 5
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

  test "source mode fits the first document page inside the side preview" do
    visit new_document_path
    click_on "Source"
    wait_for_settled_document_projection

    bounds = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const preview = document.querySelector(".preview-pane");
        const frame = preview.querySelector(".document-page-frame");
        const previewStyle = getComputedStyle(preview);
        const previewRect = preview.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        return {
          frameLeft: frameRect.left,
          frameTop: frameRect.top,
          frameRight: frameRect.right,
          frameBottom: frameRect.bottom,
          contentLeft: previewRect.left + parseFloat(previewStyle.borderLeftWidth) + parseFloat(previewStyle.paddingLeft),
          contentTop: previewRect.top + parseFloat(previewStyle.borderTopWidth) + parseFloat(previewStyle.paddingTop),
          contentRight: previewRect.right - parseFloat(previewStyle.borderRightWidth) - parseFloat(previewStyle.paddingRight),
          contentBottom: previewRect.bottom - parseFloat(previewStyle.borderBottomWidth) - parseFloat(previewStyle.paddingBottom)
        };
      })()
    JAVASCRIPT

    assert_operator bounds["frameLeft"], :>=, bounds["contentLeft"], bounds.inspect
    assert_operator bounds["frameTop"], :>=, bounds["contentTop"], bounds.inspect
    assert_operator bounds["frameRight"], :<=, bounds["contentRight"], bounds.inspect
    assert_operator bounds["frameBottom"], :<=, bounds["contentBottom"], bounds.inspect

    click_on "Visual"
    assert_equal "", page.evaluate_script('document.querySelector(".document-page-frame").style.width')
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

  test "source mode pastes and drops local images at the cursor and keeps text paste working" do
    document = Document.create!(title: "Source image gestures", source: "# Source image gestures\n\nLead text.\n\nTail text.")
    visit edit_document_path(document, editor_mode: "source")
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="

    paste_result = page.execute_script(<<~JAVASCRIPT, png)
      const editor = document.querySelector('.source-field').editorController;
      const insertion = editor.value.indexOf('Tail text.');
      editor.setSelectionRange(insertion);
      editor.focus();
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === 'POST' && String(url).endsWith('/assets')) {
          const uploadedFile = options.body.get('file');
          window.sourceImageUpload = { name: uploadedFile.name, type: uploadedFile.type };
          window.fetch = originalFetch;
          return new Promise((resolve, reject) => {
            window.setTimeout(() => originalFetch(url, options).then(resolve, reject), 250);
          });
        }
        return originalFetch(url, options);
      };
      const bytes = Uint8Array.from(atob(arguments[0]), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'blob', { type: '' }));
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      editor.view.contentDOM.dispatchEvent(event);
      const status = document.querySelector('.media-upload-status');
      return { prevented: event.defaultPrevented, sourceMode: editor.editingMode, progress: status.textContent, busy: status.getAttribute('aria-busy') };
    JAVASCRIPT
    assert_equal "source", paste_result["sourceMode"]
    assert paste_result["prevented"]
    assert_equal "Preparing image…", paste_result["progress"]
    assert_equal "true", paste_result["busy"]
    assert_selector ".media-upload-status", text: "Uploading blob.png…", wait: 5
    assert_equal({ "name" => "blob.png", "type" => "image/png" }, page.evaluate_script("window.sourceImageUpload"))

    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      const insertion = editor.value.indexOf('Tail text.');
      editor.replaceRange('Inserted while importing. ', insertion, insertion);
    JAVASCRIPT
    assert_selector ".media-upload-status", text: /blob\.png added to the Markdown source/i, wait: 8

    pasted_source = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    assert_operator pasted_source.index("Lead text."), :<, pasted_source.index("elef-asset:")
    assert_operator pasted_source.index("elef-asset:"), :<, pasted_source.index("Inserted while importing.")
    assert_operator pasted_source.index("Inserted while importing."), :<, pasted_source.index("Tail text.")
    assert_selector ".preview-pane img.presentation-media", count: 1, wait: 8
    assert_operator page.evaluate_script("document.querySelector('.preview-pane img.presentation-media').naturalWidth"), :>, 0

    drop_result = page.execute_script(<<~JAVASCRIPT, png)
      const editor = document.querySelector('.source-field').editorController;
      const insertion = editor.value.indexOf('Tail text.');
      const coordinates = editor.view.coordsAtPos(insertion);
      const resolvedPosition = editor.view.posAtCoords({ x: coordinates.left, y: (coordinates.top + coordinates.bottom) / 2 });
      const bytes = Uint8Array.from(atob(arguments[0]), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'dropped-document.png', { type: 'image/png' }));
      const options = {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: coordinates.left,
        clientY: (coordinates.top + coordinates.bottom) / 2
      };
      const dragover = new DragEvent('dragover', options);
      const drop = new DragEvent('drop', options);
      editor.view.contentDOM.dispatchEvent(dragover);
      editor.view.contentDOM.dispatchEvent(drop);
      const status = document.querySelector('.media-upload-status');
      return { intendedPosition: insertion, resolvedPosition, dragoverPrevented: dragover.defaultPrevented, dropPrevented: drop.defaultPrevented, progress: status.textContent, busy: status.getAttribute('aria-busy') };
    JAVASCRIPT
    assert drop_result["dragoverPrevented"], drop_result.inspect
    assert drop_result["dropPrevented"], drop_result.inspect
    assert_equal drop_result["intendedPosition"], drop_result["resolvedPosition"], drop_result.inspect
    assert_equal "Preparing image…", drop_result["progress"]
    assert_equal "true", drop_result["busy"]
    assert_selector ".media-upload-status", text: "Uploading dropped-document.png…", wait: 5
    assert_selector ".media-upload-status", text: /dropped-document\.png added to the Markdown source/i, wait: 8

    dropped_source = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    assert_equal 2, dropped_source.scan("elef-asset:").length
    assert_operator dropped_source.index("elef-asset:"), :<, dropped_source.rindex("elef-asset:")
    assert_operator dropped_source.rindex("elef-asset:"), :<, dropped_source.index("Tail text.")
    assert_selector ".preview-pane img.presentation-media", count: 2, wait: 8
    assert_equal 2, document.reload.assets.count
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 8

    before_failed_upload = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    failed_upload = page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === 'POST' && String(url).endsWith('/assets')) {
          window.fetch = originalFetch;
          return Promise.resolve(new Response(JSON.stringify({ error: 'Upload rejected.' }), {
            status: 422,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return originalFetch(url, options);
      };
      const transfer = new DataTransfer();
      transfer.items.add(new File(['not a valid image'], 'failed-document.png', { type: 'image/png' }));
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      editor.view.contentDOM.dispatchEvent(event);
      return { prevented: event.defaultPrevented };
    JAVASCRIPT
    assert failed_upload["prevented"]
    assert_selector ".media-upload-status", exact_text: "Upload rejected.", wait: 5
    assert_equal "false", page.find(".media-upload-status")["aria-busy"]
    assert_equal before_failed_upload, page.evaluate_script("document.querySelector('.source-field').editorController.value")

    text_paste = page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'ordinary pasted words');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      editor.view.contentDOM.dispatchEvent(event);
      return { prevented: event.defaultPrevented, source: editor.value };
    JAVASCRIPT
    assert text_paste["prevented"]
    assert_includes text_paste["source"], "ordinary pasted words"

    before_unsupported_paste = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    unsupported_paste = page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      const transfer = new DataTransfer();
      transfer.items.add(new File(['not an image'], 'notes.txt', { type: 'text/plain' }));
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      editor.view.contentDOM.dispatchEvent(event);
      return { prevented: event.defaultPrevented, source: editor.value };
    JAVASCRIPT
    assert unsupported_paste["prevented"]
    assert_equal before_unsupported_paste, unsupported_paste["source"]
    assert_selector ".media-upload-status", text: "Choose an image file to insert into source mode."
    assert_equal "false", page.find(".media-upload-status")["aria-busy"]
  end

  test "media transfer handling deduplicates file-list and item entries" do
    document = Document.create!(title: "Media transfer deduplication", source: "# Media transfer deduplication")
    visit edit_document_path(document, editor_mode: "source")

    result = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[0];
      const waitForMedia = () => {
        const media = window.Stimulus.getControllerForElementAndIdentifier(document.querySelector('.visual-editor-form'), 'media');
        if (!media) {
          window.setTimeout(waitForMedia, 10);
          return;
        }
        const listed = new File(['same bytes'], 'same.png', { type: 'image/png' });
        const itemCopy = new File(['same bytes'], 'same.png', { type: 'image/png' });
        let duplicateItemReads = 0;
        const combined = media.filesFromTransfer({
          files: [listed],
          items: [{ kind: 'file', getAsFile: () => { duplicateItemReads += 1; return itemCopy; } }]
        });
        const fromItems = media.filesFromTransfer({
          files: [],
          items: [{ kind: 'file', getAsFile: () => itemCopy }]
        });
        done({ combinedCount: combined.length, duplicateItemReads, fallbackCount: fromItems.length });
      };
      waitForMedia();
    JAVASCRIPT

    assert_equal 1, result["combinedCount"]
    assert_equal 0, result["duplicateItemReads"]
    assert_equal 1, result["fallbackCount"]
  end

  test "source media paste and drop tolerate an unavailable editor and disconnect clears tracked ranges" do
    document = Document.create!(title: "Source image readiness", source: "# Source image readiness\n\nKeep this source.")
    visit edit_document_path(document, editor_mode: "source")
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="

    unavailable_result = page.execute_script(<<~JAVASCRIPT, png)
      const sourceField = document.querySelector('.source-field');
      const editor = sourceField.editorController;
      const source = editor.value;
      const surface = document.querySelector('.editor-surface');
      const bytes = Uint8Array.from(atob(arguments[0]), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'readiness.png', { type: 'image/png' }));
      delete sourceField.editorController;
      const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      surface.dispatchEvent(paste);
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 0, clientY: 0 });
      surface.dispatchEvent(drop);
      sourceField.editorController = editor;
      return { pastePrevented: paste.defaultPrevented, dropPrevented: drop.defaultPrevented, source, currentSource: editor.value };
    JAVASCRIPT
    refute unavailable_result["pastePrevented"]
    refute unavailable_result["dropPrevented"]
    assert_equal unavailable_result["source"], unavailable_result["currentSource"]
    assert_selector ".media-upload-status", text: /source editor is not ready yet/i
    assert_equal "false", page.find(".media-upload-status")["aria-busy"]

    lifecycle_result = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[0];
      const sourceField = document.querySelector('.source-field');
      const editor = sourceField.editorController;
      editor.trackMediaRange({ from: 0, to: 0 });
      sourceField.remove();
      requestAnimationFrame(() => requestAnimationFrame(() => done({
        pendingRanges: editor.pendingMediaRanges.size,
        destroyed: editor.destroyed
      })));
    JAVASCRIPT
    assert_equal 0, lifecycle_result["pendingRanges"]
    assert lifecycle_result["destroyed"]
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

  test "enter after a code fence opener inserts a matching closing fence" do
    [["```sql", "```"], ["~~~sql", "~~~"]].each do |opening, closing|
      visit new_document_path

      find(".document-editor-block h1", text: "Untitled document").send_keys(:enter)
      active_document_block.send_keys(opening, :enter)

      expected = Regexp.new(Regexp.escape("#{opening}\n\n#{closing}"))
      assert_field "Markdown source", with: expected, wait: 5
      assert_selector ".document-editor-block[contenteditable='true'] pre code", text: "", wait: 5

      active_document_block.send_keys("SELECT * FROM TABLE")
      completed = Regexp.new(Regexp.escape("#{opening}\nSELECT * FROM TABLE\n#{closing}"))
      assert_field "Markdown source", with: completed, wait: 5
    end
  end

  test "enter after a display math opener inserts its matching closing fence" do
    [["$$", "$$"], ["\\[", "\\]"]].each do |opening, closing|
      visit new_document_path
      find(".document-editor-block h1", text: "Untitled document").send_keys(:enter)
      active_document_block.send_keys(opening, :enter)

      expected = Regexp.new(Regexp.escape("#{opening}\n\n#{closing}"))
      assert_field "Markdown source", with: expected, wait: 5

      active_document_block.send_keys("x=1")
      completed = Regexp.new(Regexp.escape("#{opening}\nx=1\n#{closing}"))
      assert_field "Markdown source", with: completed, wait: 5
      assert_selector ".document-editor-block .editor-live-math-display", wait: 5
    end
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

  test "keeps an active math chain literal until commit and supports one-step undo" do
    document = Document.create!(title: "Math notes", source: "# Math")
    visit edit_document_path(document)
    click_on "Source"
    source = find_field("Markdown source")
    editor = find(".cm-content")
    editor.send_keys(:end)
    editor.send_keys("\n$x.b.vec.t")
    assert_includes source.value, "$x.b.vec.t$"
    editor.send_keys(" ")

    assert_includes source.value, "\\vec{\\mathbf{x}}^{\\mathsf{T}} $"
    editor.send_keys([:control, "z"])
    assert_includes source.value, "$x.b.vec.t$"
    assert_selector '[data-autosave-target="status"]', text: "Saved", wait: 5
  end

  test "supports editing an active math chain before committing it" do
    document = Document.create!(title: "Editable math chain", source: "# Math")
    visit edit_document_path(document)
    click_on "Source"
    source_field = find_field("Markdown source")
    editor = find(".cm-content")
    editor.send_keys(:end)
    editor.send_keys("\n$x.vec.t")

    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector(".source-field").editorController;
      const source = editor.value;
      editor.setSelectionRange(source.indexOf("x.vec.t") + 1);
      editor.focus();
    JAVASCRIPT
    editor.send_keys(".b")
    assert_includes source_field.value, "$x.b.vec.t$"

    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector(".source-field").editorController;
      editor.setSelectionRange(editor.value.indexOf("$", editor.value.indexOf("x.b.vec.t")));
      editor.focus();
    JAVASCRIPT
    editor.send_keys(:tab)

    assert_includes source_field.value, "\\vec{\\mathbf{x}}^{\\mathsf{T}}"
    refute_includes source_field.value, "x.b.vec.t"
  end

  test "autosave preserves an active math chain verbatim" do
    document = Document.create!(title: "Autosaved math chain", source: "# Math")
    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    source = find_field("Markdown source")
    editor.send_keys(:end)
    editor.send_keys("\n$x.b")
    assert_includes source.value, "$x.b$"

    assert_selector '[data-autosave-target="status"]', text: "Unsaved changes", wait: 3
    assert_selector '[data-autosave-target="status"]', text: "Saved", wait: 10
    assert_equal "# Math\n$x.b$", source.value
    assert_equal "# Math\n$x.b$", document.reload.source
  end

  test "typing a colon directive inserts canonical source and guides align arguments" do
    document = Document.create!(title: "Directive palette", source: "# Notes")
    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.send_keys(:end)
    editor.send_keys("\n:align")

    source = find_field("Markdown source")
    assert_includes source.value, ":::align{}"
    refute_includes source.value.lines, ":align"
    assert_selector ".snippet-palette [role='option'] strong", text: "left"
    assert_selector ".snippet-palette [role='option'] strong", text: "center"

    editor.send_keys("center ")
    assert_includes source.value, ":::align{center }"
    assert_selector ".snippet-palette [role='option'] strong", text: "top"
    assert_selector ".snippet-palette [role='option'] strong", text: "middle"
    assert_selector ".snippet-palette [role='option'] strong", text: "bottom"
    assert_no_selector ".snippet-palette [role='option'] strong", text: "left"
  end

  test "slash palette inserts canonical image source" do
    document = Document.create!(title: "Source palette", source: "# Notes")
    visit edit_document_path(document)
    click_on "Source"
    source = find_field("Markdown source")
    editor = find(".cm-content")
    editor.send_keys(:end)
    editor.send_keys("\n/image")
    assert_selector ".snippet-palette [role='option']", text: /Image/
    editor.send_keys(:enter)

    assert_includes source.value, "![description](image URL)"
    refute_includes source.value, "/image"
    selected_image_placeholder = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector(".source-field").editorController;
        return editor.value.slice(editor.selectionStart, editor.selectionEnd);
      })()
    JAVASCRIPT
    assert_equal "description", selected_image_placeholder

  end

  test "supports only the v1 math transforms and preserves invalid chains" do
    document = Document.create!(title: "Math transforms", source: "# Math")
    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    source = find_field("Markdown source")
    editor.send_keys(:end)

    editor.send_keys("\n$\\alpha.b")
    editor.send_keys(:enter)
    assert_includes source.value, "\\boldsymbol{\\alpha}"

    editor.send_keys(:right)
    editor.send_keys("\n$R.bb")
    editor.send_keys(:enter)
    assert_includes source.value, "\\mathbb{R}"

    editor.send_keys(:right)
    editor.send_keys("\n$A.inv.t")
    editor.send_keys(:enter)
    assert_includes source.value, "\\left(A^{-1}\\right)^{\\mathsf{T}}"

    editor.send_keys(:right)
    editor.send_keys("\n$x.invalid")
    editor.send_keys(:enter)
    assert_includes source.value, "$x.invalid"
  end

  test "slash palette hides raw LaTeX outside math and keeps equation blocks available" do
    document = Document.create!(title: "Slash context", source: "# Notes")
    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.send_keys(:end)
    editor.send_keys("\n/frac")

    assert_no_selector ".snippet-palette [role='option']", text: /Fraction/, wait: 1

    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector(".source-field").editorController;
      editor.replaceRange("/equation", editor.value.length - "/frac".length, editor.value.length);
    JAVASCRIPT
    assert_selector ".snippet-palette [role='option']", text: /Equation/, wait: 5
  end

  test "leaves dot syntax literal outside math and inside code" do
    document = Document.create!(title: "Math contexts", source: "# Math")
    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.send_keys(:end)
    editor.send_keys("\nOutside x.b\n\n```\n$x.b\n```")
    editor.send_keys(:end)
    editor.send_keys(:enter)

    source = find_field("Markdown source").value
    assert_includes source, "Outside x.b"
    assert_includes source, "```\n$x.b\n```"
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

  test "paginates the visual editor and keeps oversized paragraph edits mapped to one source block" do
    paragraph = ("Flowing text stays at a fixed size and carries onto the next A4 page. " * 190).strip
    source = "# A4 flow\n\n#{paragraph}"
    document = Document.create!(title: "Flowing editor", source: source)

    visit edit_document_path(document)

    assert_selector ".document-editor-projection .document-surface.is-paginated"
    assert_selector ".document-editor-projection .document-page", minimum: 2, wait: 5
    wait_for_settled_document_projection
    fragment_count = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll('.document-editor-block[data-editor-block-id]')]
        .filter((block) => block.querySelector('p')?.textContent.includes('Flowing text')).length
    JAVASCRIPT
    assert_operator fragment_count, :>=, 2
    assert_equal paragraph, page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll('.document-editor-block[data-editor-block-id]')]
        .filter((block) => block.querySelector('p')?.textContent.includes('Flowing text'))
        .map((block) => block.querySelector('p').textContent)
        .join('')
    JAVASCRIPT

    last_fragment = all(".document-editor-block[data-editor-block-id]").last
    assert_includes last_fragment.text, "next A4 page."
    page.execute_script(<<~JAVASCRIPT, last_fragment)
      const block = arguments[0];
      const paragraph = block.querySelector('p') || block;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(false);
      block.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    JAVASCRIPT
    last_fragment.send_keys(" Continued")
    assert_field "Markdown source", with: source.sub(paragraph, "#{paragraph} Continued"), wait: 5

    focused_fragment = active_document_block
    assert_includes focused_fragment.text, "Continued"
    focused_fragment.send_keys(:enter)
    wait_for_settled_document_projection
    assert_field "Markdown source", with: /Continued\n\n\z/, wait: 5
    active_document_block.send_keys(:backspace)
    wait_for_settled_document_projection
    assert_field "Markdown source", with: /Continued\z/, wait: 5
  end

  test "repacks document and removes trailing page when content is shortened" do
    paragraph = ("Flowing text stays at a fixed size and carries onto the next A4 page. " * 60).strip
    source = "# A4 flow\n\n#{paragraph}"
    document = Document.create!(title: "Flowing editor", source: source)

    visit edit_document_path(document)

    assert_selector ".document-editor-projection .document-surface.is-paginated"
    assert_selector ".document-editor-projection .document-page", minimum: 2, wait: 5
    wait_for_settled_document_projection

    page.execute_script(<<~JAVASCRIPT)
      const blocks = document.querySelectorAll(".document-editor-block[data-editor-block-id]");
      const paragraphFragment = [...blocks].find((block) => (block.querySelector('p') || block).textContent.includes('Flowing text'));
      if (!paragraphFragment) return;
      const rootBlock = paragraphFragment.closest("[data-document-page-flow-id]") || paragraphFragment;
      const flowId = rootBlock.dataset.documentPageFlowId;
      document.querySelectorAll(`[data-document-page-flow-id='${flowId}']`).forEach((frag, idx) => {
        if (idx === 0) {
          (frag.querySelector('p') || frag).textContent = "Short text.";
        } else {
          frag.remove();
        }
      });
      const reader = rootBlock.closest("[data-controller~='document-pages']");
      window.Stimulus.getControllerForElementAndIdentifier(reader, "document-pages").schedulePagination();
    JAVASCRIPT
    wait_for_settled_document_projection

    assert_selector ".document-editor-projection .document-page", count: 1
  end

  test "paginates oversized lists across pages and preserves list editing" do
    items = (1..60).map { |n| "- List item #{n} with explanatory text" }.join("\n")
    document = Document.create!(title: "List pagination", source: items)

    visit edit_document_path(document)

    assert_selector ".document-editor-projection .document-surface.is-paginated"
    assert_selector ".document-editor-projection .document-page", minimum: 2, wait: 5
    wait_for_settled_document_projection

    assert_selector ".document-page-frame:first-child li", text: "List item 1 with explanatory text"
    assert_selector ".document-page-frame:last-child li", text: "List item 60 with explanatory text"

    page.execute_script(<<~JAVASCRIPT)
      const blocks = document.querySelectorAll(".document-editor-block[data-editor-block-id]");
      const block = blocks[blocks.length - 1];
      const item = block.querySelector('li:last-child') || block;
      const range = document.createRange();
      range.selectNodeContents(item);
      range.collapse(false);
      block.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    JAVASCRIPT
    active_document_block.send_keys(" extra")
    assert_field "Markdown source", with: /List item 60 with explanatory text extra/, wait: 5
  end

  test "paginates oversized blockquotes across pages and preserves quote editing" do
    quotes = (1..50).map { |n| "> Paragraph #{n} inside the blockquote explaining something at length." }.join("\n>\n")
    document = Document.create!(title: "Quote pagination", source: quotes)

    visit edit_document_path(document)

    assert_selector ".document-editor-projection .document-surface.is-paginated"
    assert_selector ".document-editor-projection .document-page", minimum: 2, wait: 5
    wait_for_settled_document_projection

    assert_selector ".document-page-frame:first-child blockquote p", text: /Paragraph 1/
    assert_selector ".document-page-frame:last-child blockquote p", text: /Paragraph 50/

    page.execute_script(<<~JAVASCRIPT)
      const blocks = document.querySelectorAll(".document-editor-block[data-editor-block-id]");
      const block = blocks[blocks.length - 1];
      const quote = block.querySelector('blockquote p:last-child') || block;
      const range = document.createRange();
      range.selectNodeContents(quote);
      range.collapse(false);
      block.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    JAVASCRIPT
    active_document_block.send_keys(" noted")
    assert_field "Markdown source", with: /Paragraph 50 inside the blockquote.*noted/, wait: 5
  end

  test "paginates oversized tables across pages" do
    rows = (1..60).map { |n| "| Row #{n} | Value #{n} description text |" }.join("\n")
    source = "# Table pagination\n\n| Item | Description |\n| --- | --- |\n#{rows}"
    document = Document.create!(title: "Table pagination", source: source)

    visit document_path(document)

    assert_selector ".document-surface.is-paginated"
    assert_selector ".document-page", minimum: 2, wait: 5
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 10

    assert_selector ".document-page-frame:first-child table tbody tr", text: /Row 1/
    assert_selector ".document-page-frame:last-child table tbody tr", text: /Row 60/
  end

  test "paginates oversized code blocks across pages" do
    lines = (1..70).map { |n| "const line#{n} = 'code statement number #{n}';" }.join("\n")
    source = "# Code pagination\n\n```javascript\n#{lines}\n```"
    document = Document.create!(title: "Code pagination", source: source)

    visit document_path(document)

    assert_selector ".document-surface.is-paginated"
    assert_selector ".document-page", minimum: 2, wait: 5
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 10

    assert_selector ".document-page-frame:first-child pre", text: /line1/
    assert_selector ".document-page-frame:last-child pre", text: /line70/
  end

  test "keeps a heading with its following paragraph when the page is full" do
    filler = "Filler content leaves room for the heading, but not its paragraph."
    paragraph = "The first paragraph fragment must stay with its heading."
    document = Document.create!(title: "Heading pagination", source: "#{filler}\n\n## Section heading\n\n#{paragraph}")

    visit document_path(document)
    assert_selector ".document-surface.is-paginated"
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 5

    first_pagination_settled = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const surface = document.querySelector(".document-surface");
      const filler = [...surface.querySelectorAll("p")].find((paragraph) => paragraph.textContent === #{filler.to_json});
      const heading = surface.querySelector("h2");
      const content = filler.closest(".document-page-content");
      filler.style.margin = "0";
      heading.style.marginTop = "0";
      const headingStyle = getComputedStyle(heading);
      const headingHeight = heading.getBoundingClientRect().height + parseFloat(headingStyle.marginBottom);
      filler.style.height = `${content.clientHeight - headingHeight - 1}px`;
      const reader = heading.closest("[data-controller~='document-pages']");
      surface.addEventListener("elef:document-pages-settled", () => done(true), { once: true });
      window.Stimulus.getControllerForElementAndIdentifier(reader, "document-pages").paginate();
    JAVASCRIPT
    assert first_pagination_settled, "document pagination did not settle"

    pages_after_move = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".document-page-content")].map((content) => ({
        heading: content.querySelector("h2")?.textContent,
        paragraphs: [...content.querySelectorAll("p")].map((paragraph) => paragraph.textContent)
      }))
    JAVASCRIPT
    filler_page_index = pages_after_move.index { |entry| entry["paragraphs"].include?(filler) }
    heading_page_index = pages_after_move.index { |entry| entry["heading"] == "Section heading" }
    assert_operator heading_page_index, :>, filler_page_index
    heading_page = pages_after_move[heading_page_index]
    assert heading_page, "expected the section heading to remain on a page"
    assert_equal [paragraph], heading_page["paragraphs"]

    final_pagination_settled = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const surface = document.querySelector(".document-surface");
      const heading = surface.querySelector("h2");
      const content = heading.closest(".document-page-content");
      heading.style.marginBottom = `${content.clientHeight}px`;
      const reader = heading.closest("[data-controller~='document-pages']");
      surface.addEventListener("elef:document-pages-settled", () => done(true), { once: true });
      window.Stimulus.getControllerForElementAndIdentifier(reader, "document-pages").paginate();
    JAVASCRIPT
    assert final_pagination_settled, "document pagination did not settle"

    final_heading_page = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const heading = [...document.querySelectorAll(".document-page-content")]
        .find((content) => content.querySelector("h2")?.textContent === "Section heading");
        return {
          paragraphs: [...heading.querySelectorAll("p")].map((paragraph) => paragraph.textContent),
          overflowing: heading.closest(".document-page").classList.contains("is-overflowing-content")
        };
      })()
    JAVASCRIPT
    assert_equal [paragraph], final_heading_page["paragraphs"]
    assert final_heading_page["overflowing"]
  end

  test "removes an empty visual block at the beginning without shifting the following page content" do
    document = Document.create!(title: "Leading empty block", source: "# First page\n\nBody text")
    visit edit_document_path(document)

    body = find(".document-editor-block", text: "Body text")
    page.execute_script(<<~JAVASCRIPT, body)
      const block = arguments[0];
      const text = block.querySelector('p').firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 0);
      block.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    JAVASCRIPT
    assert_selector ".document-editor-block[data-editor-empty-block='true']", count: 1, wait: 5

    first_empty = find(".document-editor-block[data-editor-empty-block='true']")
    first_empty.send_keys(:backspace)
    assert_selector ".document-editor-block", text: "Body text", wait: 5
    assert_no_selector ".document-editor-block[data-editor-empty-block='true']"
    assert_includes find_field("Markdown source").value, "Body text"
  end

  test "horizontal-only document positions stay content-sized" do
    document = Document.create!(
      title: "Inline positions",
      source: <<~MARKDOWN
        :::align{left}

        Left stays ordinary.

        :::align{center}

        Center stays ordinary.

        :::align{right}

        Right stays ordinary.
      MARKDOWN
    )

    visit document_path(document)

    heights = page.evaluate_script("[...document.querySelectorAll('.document-block')].map((block) => block.getBoundingClientRect().height)")
    assert_equal 3, heights.length
    assert heights.all? { |height| height < 120 }, "horizontal-only blocks should not become vertical stages: #{heights.inspect}"
  end

  test "positions document blocks visually and preserves directives across source mode" do
    source = "# Alignment\n\nLeft block\n\n:::align{center center}\n\nCentered block"
    document = Document.create!(title: "Block alignment", source: source)
    visit edit_document_path(document)
    wait_for_fresh_projection

    left = find(".document-editor-block", text: "Left block")
    left_id = left["data-editor-block-id"]
    left.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{left_id}']").select("Right")

    assert_field "Markdown source", with: /:::align\{right\}\n\nLeft block/, wait: 5
    right_aligned = find(".document-editor-block.position-right", text: "Left block", wait: 5)
    assert_equal left_id, right_aligned["data-editor-block-id"]
    assert_equal left_id, page.evaluate_script("document.activeElement?.dataset.editorBlockId")
    assert_equal "right", page.evaluate_script("getComputedStyle(arguments[0]).textAlign", right_aligned)
    type_visual_text(".document-editor-block", "Left block", "Updated left block")
    assert_field "Markdown source", with: /:::align\{right\}\n\nUpdated left block/, wait: 5
    page.execute_script("document.activeElement.blur()")
    wait_for_fresh_projection

    centered = find(".document-editor-block", text: "Centered block")
    assert_includes centered["class"], "position-center"
    assert_equal "center", page.evaluate_script("getComputedStyle(arguments[0]).textAlign", centered)
    centered.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    centered_control = find("[data-visual-editor-block-id='#{centered['data-editor-block-id']}']")
    centered_control.select("Right")

    assert_field "Markdown source", with: /:::align\{center right\}/, wait: 5
    assert_selector ".document-editor-block.position-right", text: "Centered block", wait: 5
    right_aligned = find(".document-editor-block.position-right", text: "Centered block")
    assert_equal "right", page.evaluate_script("getComputedStyle(arguments[0]).textAlign", right_aligned)
    right_aligned.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{right_aligned['data-editor-block-id']}']").select("Left")
    assert_field "Markdown source", with: /:::align\{center left\}/, wait: 5
    left_aligned = find(".document-editor-block.position-left", text: "Centered block", wait: 5)
    assert_equal "left", page.evaluate_script("getComputedStyle(arguments[0]).textAlign", left_aligned)
    centered_id = left_aligned["data-editor-block-id"]
    left_aligned.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    assert_equal "left", find("[data-visual-editor-block-id='#{centered_id}']").value

    click_on "Source"
    assert_field "Markdown source", with: /:::align\{right\}\n\nUpdated left block/
    assert_field "Markdown source", with: /:::align\{center left\}\n\nCentered block/
    click_on "Visual"
    wait_for_fresh_projection

    centered = find(".document-editor-block", text: "Centered block")
    assert_includes centered["class"], "position-left"
    centered.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    assert_equal "left", find("[data-visual-editor-block-id='#{centered['data-editor-block-id']}']").value
    type_visual_text(".document-editor-block", "Centered block", "Updated centered block")
    assert_field "Markdown source", with: /:::align\{right\}\n\nUpdated left block\n\n:::align\{center left\}\n\nUpdated centered block/, wait: 5
    refute_includes find(".editor-projection").text, ":::align"
  end

  test "positions the first document block when no source content precedes it" do
    document = Document.create!(title: "First block alignment", source: "Test")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Test")
    block_id = block["data-editor-block-id"]
    block.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    alignment = find("[data-visual-editor-block-id='#{block_id}']")
    assert_equal "left", alignment.value
    assert_field "Markdown source", with: "Test"

    find(".document-editor-block[data-editor-block-id='#{block_id}']").find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    alignment.select("Center")

    assert_field "Markdown source", with: /\A:::align\{center\}\n\nTest\z/, wait: 5

    find(".document-editor-block[data-editor-block-id='#{block_id}']").find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{block_id}']").select("Right")
    assert_field "Markdown source", with: /\A:::align\{right\}\n\nTest\z/, wait: 5
  end

  test "pins the block alignment control until selection is dismissed" do
    visit root_path
    find(".new-work-menu summary").click
    find(".new-work-option", text: "Document").click
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Untitled document")
    block.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    control = find("[data-visual-editor-block-id='#{block['data-editor-block-id']}']")
    select_style = page.evaluate_script(<<~JAVASCRIPT, control)
      (() => {
        const style = getComputedStyle(arguments[0]);
        return { borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle, background: style.backgroundColor };
      })()
    JAVASCRIPT
    assert_equal "1px", select_style["borderWidth"]
    assert_equal "solid", select_style["borderStyle"]
    refute_equal "rgba(0, 0, 0, 0)", select_style["background"]
    control.click
    # Simulate the select losing DOM focus while its native popup is being used.
    page.execute_script("arguments[0].blur()", control)
    page.driver.browser.action.move_to_location(20, 20).perform

    control_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const label = document.querySelector('.document-block-position-control');
        return { open: label.classList.contains('is-open'), opacity: getComputedStyle(label).opacity, pointerEvents: getComputedStyle(label).pointerEvents };
      })()
    JAVASCRIPT
    assert_equal true, control_state["open"]
    assert_equal "1", control_state["opacity"]
    assert_equal "auto", control_state["pointerEvents"]

    page.execute_script("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
    dismissed_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const label = document.querySelector('.document-block-position-control');
        return label.classList.contains('is-open');
      })()
    JAVASCRIPT
    assert_equal false, dismissed_state

    block.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    control.select("Center")
    assert_field "Markdown source", with: /\A:::align\{center\}\n\n# Untitled document\z/, wait: 5
    centered_heading = find(".document-editor-block.position-center h1", text: "Untitled document", wait: 5)
    assert_equal "center", page.evaluate_script("getComputedStyle(arguments[0]).textAlign", centered_heading)
  end

  test "changes a position directive on the first document block" do
    document = Document.create!(title: "Change first block alignment", source: ":::align{right}\n\nTest")
    visit edit_document_path(document)
    wait_for_fresh_projection

    block = find(".document-editor-block", text: "Test")
    block_id = block["data-editor-block-id"]
    block.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{block_id}']").select("Center")

    assert_field "Markdown source", with: /\A:::align\{center\}\n\nTest\z/, wait: 5
  end

  test "changes a position directive added in source mode" do
    document = Document.create!(title: "Source mode alignment", source: "Test")
    visit edit_document_path(document)
    wait_for_fresh_projection

    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      document.querySelector(".source-field").editorController.replaceRange(":::align{right}\\n\\n", 0, 0)
    JAVASCRIPT
    assert_field "Markdown source", with: /\A:::align\{right\}\n\nTest\z/, wait: 5
    click_on "Visual"
    wait_for_fresh_projection
    assert_field "Markdown source", with: /\A:::align\{right\}\n\nTest\z/, wait: 5

    block = find(".document-editor-block", text: "Test")
    block_id = block["data-editor-block-id"]
    block.find(:xpath, "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' document-editor-block-shell ')]").hover
    find("[data-visual-editor-block-id='#{block_id}']").select("Center")

    assert_field "Markdown source", with: /\A:::align\{center\}\n\nTest\z/, wait: 5
  end

  test "deleting an empty positioned block also removes its position directive" do
    document = Document.create!(
      title: "Delete positioned block",
      source: "# Keep\n\n:::align{center}\n\nDelete me\n\nTail"
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
    source = "# Keep\n\n:::align{center}\n\nDelete me\n\n:::\n\nTail"
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
        const textRange = document.createRange();
        textRange.selectNodeContents(paragraph);
        const frameRect = frame.getBoundingClientRect();
        return {
          frameAspect: frameRect.width / frameRect.height,
          pageWidth: page.offsetWidth,
          pageHeight: page.offsetHeight,
          paragraphFontSize: Number.parseFloat(getComputedStyle(paragraph).fontSize),
          paragraphLines: textRange.getClientRects().length,
          paragraphText: paragraph.innerText
        };
      })()
    JAVASCRIPT

    assert_in_delta 210.0 / 297.0, desktop_measurements["frameAspect"], 0.005
    assert_equal 794, desktop_measurements["pageWidth"]
    assert_equal 1123, desktop_measurements["pageHeight"]
    assert_equal 18, desktop_measurements["paragraphFontSize"]

    # Resize to mobile / tablet width (600px)
    page.driver.browser.manage.window.resize_to(600, 900)

    mobile_measurements = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const frame = document.querySelector('.document-page-frame');
        const page = document.querySelector('.document-page');
        const paragraph = page.querySelector('p');
        const textRange = document.createRange();
        textRange.selectNodeContents(paragraph);
        const frameRect = frame.getBoundingClientRect();
        return {
          frameAspect: frameRect.width / frameRect.height,
          pageWidth: page.offsetWidth,
          pageHeight: page.offsetHeight,
          paragraphFontSize: Number.parseFloat(getComputedStyle(paragraph).fontSize),
          paragraphLines: textRange.getClientRects().length,
          paragraphText: paragraph.innerText
        };
      })()
    JAVASCRIPT

    assert_in_delta 210.0 / 297.0, mobile_measurements["frameAspect"], 0.005
    assert_equal 794, mobile_measurements["pageWidth"]
    assert_equal 1123, mobile_measurements["pageHeight"]
    assert_equal 18, mobile_measurements["paragraphFontSize"]
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
