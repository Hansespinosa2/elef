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

  test "shows orphan nodes and supports graph search, zoom, and responsive layout" do
    target = Document.create!(title: "Graph target", source: "# Target")
    source = Document.create!(title: "Graph source", source: "See [[Graph target]]")
    orphan = Document.create!(title: "Graph orphan with a long mobile document label", source: "# Orphan")

    visit documents_path
    assert_selector ".document-graph-node", count: 3
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

  test "renaming a document updates linked previews" do
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
    assert_equal "See [[Renamed target]]", incoming.reload.source
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
end
