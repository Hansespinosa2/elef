require "application_system_test_case"

class DocumentsTest < ApplicationSystemTestCase
  def wait_for_fresh_projection
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 5
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

  test "renaming a document preserves linked previews" do
    target = Document.create!(title: "Rename target", source: "# Target")
    incoming = Document.create!(title: "Rename source", source: "See [[Rename target]]")

    visit documents_path
    target_card = find("##{ActionView::RecordIdentifier.dom_id(target)}")
    page.execute_script("arguments[0].querySelector('details').open = true", target_card)
    within("##{ActionView::RecordIdentifier.dom_id(target)}") do
      find("input[type='text']").set("Renamed target")
      click_on "Save title"
    end

    assert_text "Document renamed."
    assert_equal "See [[Rename target]]", incoming.reload.source
    visit document_path(incoming)
    assert_selector "a.document-link[href='#{document_path(target)}']", text: "Renamed target"
  end

  test "creates a document and updates its continuous live preview" do
    visit new_document_path
    assert_field "Title", with: ""
    fill_in "Title", with: "Research notes"
    fill_in "Markdown source", with: "# Research notes\n\nFirst section\n\n---\n\nSecond section"
    assert_selector ".document-surface", text: "Second section", wait: 5
    assert_selector ".document-surface hr"
    click_on "Save document"

    assert_text "Document saved."
    assert_current_path %r{/documents/\d+/edit}
    assert_selector ".document-surface h1", text: "Research notes"
    fill_in "Markdown source", with: "# Research notes\n\nA live update\n\n---\n\nSecond section"
    assert_selector ".document-surface", text: "A live update", wait: 5
    assert_includes Document.order(:id).last.source, "Second section"
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

  test "visual document blocks accept direct keyboard edits" do
    document = Document.create!(title: "Typing notes", source: "# Typing notes\n\nBody")

    visit edit_document_path(document)
    block = find(".document-editor-block", text: "Body")
    block.click
    block.send_keys(:end, " changed")

    assert_field "Markdown source", with: "# Typing notes\n\nBody changed", wait: 5
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
      },
      {
        id: "document-full-report",
        operations: [
          [".document-editor-block", "The State of Calm Authoring", "The State of Calm Authoring", "The State of Testing"]
        ]
      }
    ]

    fixtures.each do |fixture|
      baseline = Documents::SampleData::SAMPLES.find { |sample| sample[:id] == fixture[:id] }.fetch(:source)
      visual = Document.create!(title: "Visual #{fixture[:id]}", source: baseline)
      source = Document.create!(title: "Source #{fixture[:id]}", source: baseline)
      expected = baseline.dup
      source_expected = baseline.dup

      visit edit_document_path(visual)
      fixture[:operations].each do |selector, visible_text, source_text, replacement|
        type_visual_text(selector, visible_text, replacement)
        expected.sub!(source_text, replacement)
        assert_field "Markdown source", with: expected, wait: 5
        page.execute_script("document.activeElement.blur()")
        wait_for_fresh_projection
        assert_selector selector, text: /#{Regexp.escape(replacement)}/, wait: 5
      end

      click_on "Save document"
      assert_selector ".flash.notice", text: "Document saved.", wait: 10
      visit edit_document_path(visual)
      assert_field "Markdown source", with: expected
      visual.reload

      visit edit_document_path(source)
      click_on "Source"
      fixture[:operations].each do |_selector, _visible_text, source_text, replacement|
        type_source_text(source_expected, source_text, replacement)
        source_expected.sub!(source_text, replacement)
        assert_field "Markdown source", with: source_expected, wait: 5
      end

      click_on "Save document"
      assert_selector ".flash.notice", text: "Document saved.", wait: 10
      visit edit_document_path(source)
      assert_field "Markdown source", with: source_expected
      assert_equal expected, source_expected
      visual_source = visual.reload.source.gsub(/\r\n?/, "\n")
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

  test "chains supported math modifiers and leaves conflicting chains intact" do
    document = Document.create!(title: "Math modifier chains", source: "# Math")
    visit edit_document_path(document)
    editor = find_field("Markdown source")
    editor.click
    editor.send_keys(:end)
    expanded = ->(symbol) { "$\\mathbf{\\bar{#{symbol}}}$" }
    chain_state = -> do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const root = document.querySelector(".source-field");
          const shorthand = window.Stimulus.getControllerForElementAndIdentifier(root, "math-shorthand");
          const palette = window.Stimulus.getControllerForElementAndIdentifier(root, "math-shortcut-palette");
          return {
            expansion: shorthand?.lastExpansion || null,
            source: shorthand?.editorController?.value || null,
            caret: shorthand?.editorController?.selectionStart ?? null,
            paletteHidden: palette?.paletteTarget?.hidden ?? null,
            paletteQuery: palette?.query || null
          };
        })()
      JAVASCRIPT
    end

    editor.send_keys("\n$x.bar")
    editor.send_keys(:enter)
    after_bar = chain_state.call
    editor.send_keys(".bb")
    after_suffix = chain_state.call
    editor.send_keys(:enter)
    editor.send_keys("$")
    assert_includes editor.value, expanded.call("x"), "bar then bold should compose across commits: #{editor.value.inspect}; after bar #{after_bar.inspect}; after suffix #{after_suffix.inspect}"

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
    sleep 0.5
    assert_equal 1, page.evaluate_script("window.previewResponses.length")

    fill_in "Markdown source", with: "# Latest response"
    sleep 0.5
    assert_equal 2, page.evaluate_script("window.previewResponses.length")

    page.execute_script(<<~JAVASCRIPT)
      const response = window.previewResponses[0];
      const title = response.source.match(/^# (.*)$/m)[1];
      response.resolve(new Response(JSON.stringify({
        html: `<div class="document-reader"><div class="document-surface"><h1>${title}</h1></div></div>`,
        warnings: [],
        editor_map: null
      }), { headers: { "Content-Type": "application/json" } }));
    JAVASCRIPT
    sleep 0.1
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

  test "renders the seeded document fixture library and its stress cases" do
    Document.delete_all

    visit documents_path

    assert_text "No documents yet"
    find("summary", text: "More").click
    click_on "Load sample documents"

    assert_selector ".document-graph-node", count: Documents::SampleData::SAMPLES.length
    assert_selector ".document-graph-edge", minimum: 1
    coordinates = page.evaluate_script(<<~JAVASCRIPT)
      JSON.parse(document.querySelector(".document-graph").dataset.documentGraphDataValue)
        .nodes.map(({ x, y }) => [x, y])
    JAVASCRIPT
    assert_equal coordinates.length, coordinates.uniq.length
    assert_text "Stress: Renderer kitchen sink"
    assert_text "Fixture: Graph orphan"
    assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=, page.evaluate_script("window.innerWidth")

    warning_document = Document.find_by!(sample_id: "document-stress-warnings")
    visit document_path(warning_document)

    assert_selector '[aria-label="Markdown warnings"]', text: /directive/
    assert_selector ".document-link.unresolved", text: "[[Fixture: Missing document]]"
    assert_no_text "javascript:"

    page.driver.browser.manage.window.resize_to(600, 900)
    assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=, page.evaluate_script("window.innerWidth")
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
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
end
