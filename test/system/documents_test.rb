require "application_system_test_case"

class DocumentsTest < ApplicationSystemTestCase
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
    assert_selector ".editor-projection", visible: :hidden
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

  test "visual rich blocks preserve table and image Markdown while editing" do
    document = Document.create!(
      title: "Rich notes",
      source: "# Rich notes\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n![Old alt](/icon.svg)"
    )

    visit edit_document_path(document)

    assert_selector ".document-editor-block table"
    assert_selector ".document-editor-block .editor-media-caption", text: "Old alt"

    page.execute_script(<<~JAVASCRIPT)
      const tableBlock = [...document.querySelectorAll('.document-editor-block')]
        .find((block) => block.querySelector('table'));
      tableBlock.querySelector('tbody td').innerText = 'Updated';
      tableBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Updated' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /\| Updated \| Two \|/, wait: 5
    assert_includes find_field("Markdown source").value, "![Old alt](/icon.svg)"

    page.execute_script(<<~JAVASCRIPT)
      const imageBlock = [...document.querySelectorAll('.document-editor-block')]
        .find((block) => block.querySelector('.editor-media-caption'));
      const caption = imageBlock.querySelector('.editor-media-caption');
      caption.innerText = 'New alt';
      caption.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'New alt' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /!\[New alt\]\(\/icon\.svg\)/, wait: 5
    assert_includes find_field("Markdown source").value, "| Updated | Two |"
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

  test "visual code editing preserves fenced language and indentation" do
    document = Document.create!(
      title: "Code notes",
      source: "# Code\n\n```ruby\n  records.each do |record|\n    process(record)\n  end\n```"
    )

    visit edit_document_path(document)

    page.execute_script(<<~JAVASCRIPT)
      const codeBlock = [...document.querySelectorAll('.document-editor-block')]
        .find((block) => block.querySelector('pre'));
      codeBlock.querySelector('code').innerText = '  updated\\n    indented';
      codeBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'updated' }));
    JAVASCRIPT

    assert_field "Markdown source", with: "# Code\n\n```ruby\n  updated\n    indented\n```", wait: 5
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
