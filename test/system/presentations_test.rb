Warning: truncated output (original token count: 25866)
Total output lines: 2084

require "application_system_test_case"
require "base64"
require "stringio"
require "tempfile"

class PresentationsTest < ApplicationSystemTestCase
  def primary_modifier
    RUBY_PLATFORM.match?(/darwin/) ? :meta : :control
  end

  def wait_for_fresh_projection
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 5
  end

  def type_visual_text(selector, visible_text, replacement)
    selector = ".editor-projection #{selector}"
    wait_for_fresh_projection
    attempts = 0
    loop do
      source_before = find_field("Markdown source").value
      expected_source = source_before.sub(visible_text, replacement)
      assert_not_equal source_before, expected_source, "could not find source text #{visible_text.inspect}"
      target = all(selector, wait: 5).find { |candidate| candidate.text.include?(visible_text) }
      assert target, "could not find visual text #{visible_text.inspect} in #{selector}"

      begin
        target.click
        selected = page.execute_script(<<~JAVASCRIPT, target, visible_text)
          const root = arguments[0];
          const needle = arguments[1];
          const editableBlock = root.closest("[contenteditable='true']") || root;
          editableBlock.focus({ preventScroll: true });
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let node;
          while (walker.nextNode()) {
            node = walker.currentNode;
            if (node.textContent.includes(needle)) break;
            node = null;
          }
          if (!node) return false;
          const start = node.textContent.indexOf(needle);
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + needle.length);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return {
            focused: document.activeElement === editableBlock,
            selected: selection.toString() === needle
          };
        JAVASCRIPT
        assert selected && selected["focused"] && selected["selected"],
          "could not focus #{visible_text.inspect} and select it for visual editing"
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

  def hold_autosaves
    page.execute_script(<<~JAVASCRIPT)
      window.autosaveRequests = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options) => {
        if (options?.method !== 'PATCH') return originalFetch(url, options);
        return new Promise((resolve, reject) => {
          window.autosaveRequests.push({
            release: () => originalFetch(url, options).then(resolve, reject)
          });
        });
      };
    JAVASCRIPT
  end

  def wait_for_autosave_request(index)
    ready = page.evaluate_async_script(<<~JAVASCRIPT, index)
      const target = arguments[0];
      const done = arguments[arguments.length - 1];
      const deadline = Date.now() + 5000;
      const wait = () => {
        if ((window.autosaveRequests || []).length > target) return done(true);
        if (Date.now() >= deadline) return done(false);
        window.setTimeout(wait, 10);
      };
      wait();
    JAVASCRIPT
    assert ready, "autosave request #{index} was not registered"
  end

  test "library renames forks and deletes a presentation through its controls" do
    parent = Presentation.create!(title: "Workflow parent", source: "# Keep this source")
    visit presentations_path
    within("#presentation_#{parent.id}") do
      find(".library-card-menu-trigger").click
      find("summary", text: "Rename").click
      find('input[aria-label="Rename Workflow parent"]').set("Renamed parent")
      click_on "Save title"
    end
    assert_text "Presentation renamed.", wait: 5
    within("article", text: "Renamed parent") do
      find(".library-card-menu-trigger").click
      find("summary", text: "Fork").click
      click_on "As inspiration"
    end
    assert_field "Title", with: "Renamed parent (Inspiration)"
    click_on "Library"
    within("#presentation_#{parent.id}") do
      find(".library-card-menu-trigger").click
      accept_confirm { click_on "Delete" }
    end
    assert_text "Presentation deleted."
    assert_text "Parent no longer available"
    assert_equal "# Keep this source", Presentation.find_by!(parent_id: nil, fork_type: "inspiration").source
  end

  test "library cards keep previews undistorted and controls isolated from the edit link" do
    document = Document.create!(title: "Card document", source: "# Card document\n\nFirst page body.\n\n## Later heading")
    presentation = Presentation.create!(title: "Card deck", source: "# Card deck\n\n---\n\n## Later slide")

    visit root_path

    geometry = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        const frame = box('.library-card .library-preview');
        const slide = box('.library-card .slide');
        const page1 = box('.library-card .library-preview-page .document-page');
        return {
          frameRatio: frame.width / frame.height,
          slideRatio: slide.width / slide.height,
          pageRatio: page1.width / page1.height,
          slideFits: slide.width <= frame.width + 1 && slide.height <= frame.height + 1,
          pageFits: page1.width <= frame.width + 1 && page1.height <= frame.height + 1,
          slideScale: getComputedStyle(document.querySelector('.library-card .slide')).getPropertyValue('--slide-scale').trim(),
          pageScale: getComputedStyle(document.querySelector('.library-card .library-preview-page')).getPropertyValue('--slide-scale').trim()
        };
      })()
    JAVASCRIPT

    assert_in_delta 16.0 / 9.0, geometry["frameRatio"], 0.02
    assert_in_delta 16.0 / 9.0, geometry["slideRatio"], 0.02
    assert_in_delta 52.0 / 72.0, geometry["pageRatio"], 0.02
    assert geometry["slideFits"], "slide preview overflows its card frame"
    assert geometry["pageFits"], "document preview overflows its card frame"
    assert_operator geometry["slideScale"].to_f, :<, 1.0
    assert_operator geometry["pageScale"].to_f, :<, 1.0

    within("#presentation_#{presentation.id}") do
      find(".library-card-preview-button").click
    end
    assert_current_path presentation_path(presentation)
    assert_selector ".presentation-surface .slide", text: "Card deck"

    visit root_path
    within("#presentation_#{presentation.id}") do
      find(".library-card-menu-trigger").click
      assert_selector "details.library-card-menu[open]"
    end
    assert_current_path root_path

    visit root_path
    find("#presentation_#{presentation.id} a.library-card-open").click
    assert_current_path edit_presentation_path(presentation)

    visit root_path
    assert_no_link "Edit Card document"
    within("#document_#{document.id}") do
      find(".library-card-title a").click
    end
    assert_current_path edit_document_path(document)
  end

  test "autosave persists newer edits after an outstanding request and keeps them dirty until saved" do
    presentation = Presentation.create!(title: "Autosave order", source: "# Original")
    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# First edit"
    assert_selector '[data-autosave-target="status"]', text: "Saving…"
    fill_in "Markdown source", with: "# Original"
    dismiss_confirm { click_on "Library" }
    assert_field "Markdown source", with: "# Original"
    fill_in "Markdown source", with: "# Latest edit"
    wait_for_autosave_request(0)
    page.execute_script("window.autosaveRequests[0].release()")
    assert_selector '[data-autosave-target="status"]', text: "Saving…"
    dismiss_confirm { click_on "Library" }
    assert_equal true, page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('form[data-controller~="autosave"]');
        return window.Stimulus.getControllerForElementAndIdentifier(form, "autosave").timer !== null;
      })()
    JAVASCRIPT
    assert_field "Markdown source", with: "# Latest edit"
    assert_includes presentation.reload.source, "# First edit"
    wait_for_autosave_request(1)
    page.execute_script("window.autosaveRequests[1].release()")
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved"
    assert_includes presentation.reload.source, "# Latest edit"
    page.evaluate_async_script(<<~JAVASCRIPT)
      window.setTimeout(() => arguments[0](), 1200);
    JAVASCRIPT
    assert_nil page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('form[data-controller~="autosave"]');
        return window.Stimulus.getControllerForElementAndIdentifier(form, "autosave").timer;
      })()
    JAVASCRIPT
    assert_equal 2, page.evaluate_script("window.autosaveRequests.length")
    assert_equal false, page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('form[data-controller~="dirty"]');
        return window.Stimulus.getControllerForElementAndIdentifier(form, "dirty").dirty;
      })()
    JAVASCRIPT
    click_on "Library"
    assert_current_path root_path
  end

  test "two editor tabs preserve a stale local draft as a recovery revision" do
    presentation = Presentation.create!(title: "Two tabs", source: "# Initial")
    visit edit_presentation_path(presentation)

    using_session(:server_tab) do
      visit edit_presentation_path(presentation)
      fill_in "Markdown source", with: "# Server tab"
      assert_selector '[data-autosave-target="status"]', text: "Saved", wait: 5
    end

    fill_in "Markdown source", with: "# Local tab"
    assert_selector '[data-autosave-target="status"]', text: "A newer version is active; your draft was preserved.", wait: 5
    assert_selector "[data-autosave-target='conflict']", visible: true
    assert_includes presentation.reload.source, "# Server tab"
    assert_includes presentation.revisions.recoveries.order(:id).last.source, "# Local tab"
  end

  test "refresh recovers an unsent draft from browser persistence" do
    presentation = Presentation.create!(title: "Refresh recovery", source: "# Initial")
    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Unsent after refresh"
    assert_selector '[data-autosave-target="status"]', text: "Saving…", wait: 5

    page.refresh

    assert_field "Markdown source", with: "# Unsent after refresh", wait: 5
    assert_selector '[data-autosave-target="status"]', text: "Recovered unsent changes", wait: 5
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 10
    assert_includes presentation.reload.source, "# Unsent after refresh"
  end

  test "explicit save waits for autosave and refreshes the latest preview" do
    presentation = Presentation.create!(title: "Manual save order", source: "# Original")
    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Earlier edit"
    assert_selector '[data-autosave-target="status"]', text: "Saving…"
    fill_in "Markdown source", with: "# Manual latest"
    click_on "Save presentation"
    page.execute_script("window.autosaveRequests[0].release()")
    assert_text "Presentation saved."
    assert_selector '.preview-pane .slide', text: "Manual latest"
    assert_includes presentation.reload.source, "# Manual latest"
  end

  test "presents from the edit screen without submitting the editor form" do
    presentation = Presentation.create!(title: "Edit presentation", source: "# Original")

    visit edit_presentation_path(presentation)
    click_on "Present"

    assert_current_path present_presentation_path(presentation)
    assert_selector "body.presentation-body"
    assert_equal "# Original", presentation.reload.source
    assert_not_nil presentation.last_published_at
  end

  test "keeps the presentation editor usable at desktop and narrow widths" do
    presentation = Presentation.create!(title: "Responsive deck", source: "# Responsive deck\n\nBody")

    visit edit_presentation_path(presentation)

    [1400, 700, 390].each do |width|
      page.driver.browser.manage.window.resize_to(width, 900)
      assert_selector ".editor-projection", visible: true
      assert_equal "visual", page.evaluate_script("document.querySelector('form.visual-editor-form').dataset.editorMode")
      geometry = page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const projection = document.querySelector('.editor-projection').getBoundingClientRect();
          return {
            width: projection.width,
            right: projection.right,
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth
          };
        })()
      JAVASCRIPT
      assert_operator geometry["width"], :>, 0
      assert_operator geometry["right"], :<=, geometry["viewport"] + 1
      assert_operator geometry["document"], :<=, geometry["viewport"] + 1
    end

    click_on "Source"
    assert_selector ".editor-projection[aria-label='Rendered preview']", visible: true
    assert_selector ".cm-content", visible: true
    [1400, 700, 390].each do |width|
      page.driver.browser.manage.window.resize_to(width, 900)
      geometry = page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const source = document.querySelector('.source-pane').getBoundingClientRect();
          const preview = document.querySelector('.editor-projection').getBoundingClientRect();
          return {
            sourceRight: source.right,
            sourceBottom: source.bottom,
            sourceWidth: source.width,
            previewLeft: preview.left,
            previewTop: preview.top,
            previewWidth: preview.width,
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth
          };
        })()
      JAVASCRIPT
      assert_operator geometry["sourceWidth"], :>, 0
      assert_operator geometry["previewWidth"], :>, 0
      if width > 900
        assert_operator geometry["sourceRight"], :<=, geometry["previewLeft"]
      else
        assert_operator geometry["sourceBottom"], :<=, geometry["previewTop"] + 1
      end
      assert_operator geometry["document"], :<=, geometry["viewport"] + 1
    end

    click_on "Visual"
    assert_selector ".editor-projection[aria-label='Visual editing surface']", visible: true
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "visual presentation editing updates source and known slide operations" do
    presentation = Presentation.create!(title: "Visual deck", source: "# First\n\nBody\n---\n# Second\n\nOther")

    visit edit_presentation_path(presentation)

    find(".editor-projection .slide-block", text: "Body").click
    page.execute_script("const block = [...document.querySelectorAll('.editor-projection .slide-block')].find((candidate) => candidate.innerText === 'Body'); block.innerText = 'Changed'; block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Changed' }));")
    assert_field "Markdown source", with: /# First\n\nChanged/, wait: 5
    page.execute_script("document.activeElement.blur()")
    wait_for_fresh_projection
    assert_no_selector "[data-presentation-editor-action='add-slide-after'][disabled]", wait: 5
    find("[data-presentation-editor-action='add-slide-after']", match: :first).click
    assert_selector ".presentation-editor-projection .slide", count: 3, wait: 5
    wait_for_fresh_projection
    state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('form.visual-editor-form');
        const controls = [...form.querySelectorAll('[data-presentation-editor-action="delete-slide"]')];
        return {
          fresh: form.previewController.projectionFresh,
          slides: form.presentationEditorController.map.slides.length,
          controlCount: controls.length,
          lastDisabled: controls.at(-1)?.disabled
        };
      })()
    JAVASCRIPT
    assert_equal({ "fresh" => true, "slides" => 3, "controlCount" => 3, "lastDisabled" => false }, state)
    refute page.evaluate_script("Boolean(document.activeElement.closest('.cm-content'))"), "visual operations must not move focus into the hidden source editor"
    accept_confirm("Delete this slide?") do
      find("[data-presentation-editor-action='delete-slide'][data-slide-index='2']").click
    end
    assert_selector ".presentation-editor-projection .slide", count: 2, wait: 5
    wait_for_fresh_projection

    find("select[data-presentation-editor-position][data-slide-index='0'][data-block-index='1']").select("Center Middle")
    assert_field "Markdown source", with: /:::position\{center middle\}/, wait: 5

    click_on "Save presentation"
    assert_text "Presentation saved."
    visit edit_presentation_path(presentation)
    assert_field "Markdown source", with: /Changed/
    assert_selector ".presentation-editor-projection .slide", count: 2
  end

  test "positions blocks in a new presentation through the visual control" do
    visit new_presentation_path
    wait_for_fresh_projection

    position = find("select[data-presentation-editor-position][data-slide-index='0'][data-block-index='1']")
    position.select("Left Top")
    assert_field "Markdown source", with: /:::position\{left top\}/, wait: 5

    wait_for_fresh_projection
    find("select[data-presentation-editor-position][data-slide-index='0'][data-block-index='1']").select("Center Middle")
    assert_field "Markdown source", with: /:::position\{center middle\}/, wait: 5
  end

  test "presentation caret follows source switches and arrow keys move between blocks" do
    source = "# First slide\n\nA paragraph\n\nNext paragraph"
    presentation = Presentation.create!(title: "Presentation caret", source: source)
    visit edit_presentation_path(presentation)

    block = find(".editor-projection .slide-block", text: "A paragraph")
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      const text = block.querySelector("p").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 3);
    JAVASCRIPT
    captured = page.evaluate_script("document.querySelector('form.visual-editor-form').presentationEditorController.captureCaret()")
    assert_equal source.index("A paragraph") + 3, captured["sourceOffset"]
    click_on "Source"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal source.index("A paragraph") + 3,
      page.evaluate_script("document.querySelector('.source-field').editorController.view.state.selection.main.head")

    click_on "Visual"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    restored = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const selection = window.getSelection();
        const block = selection.focusNode?.parentElement?.closest(".slide-block");
        return { text: block?.innerText, offset: selection.focusOffset };
      })()
    JAVASCRIPT
    assert_equal "A paragraph", restored["text"].strip
    assert_equal 3, restored["offset"]

    moved = page.execute_script(<<~JAVASCRIPT)
      const block = document.activeElement;
      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      block.dispatchEvent(event);
      return { handled: event.defaultPrevented, text: document.activeElement.innerText.trim() };
    JAVASCRIPT
    assert_equal true, moved["handled"]
    assert_equal "Next paragraph", moved["text"]
  end

  test "disables stale presentation blocks and controls until matching HTML and map install" do
    original = "# Old A\n\nOld first block\n---\n# Old B\n\nOld second block"
    updated = "# New A\n\nFresh first block\n\nFresh second block\n---\n# New B\n\nFresh third block\n---\n# New C"
    presentation = Presentation.create!(title: "Stale map recovery", source: original)

    visit edit_presentation_path(presentation)
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT, updated)
      const form = document.querySelector('form.visual-editor-form');
      form.previewController.delayValue = 5000;
      const originalFetch = window.fetch.bind(window);
      let failNextPreview = true;
      window.fetch = (url, options = {}) => {
        if (options.method === 'POST' && String(url).includes('/preview') && failNextPreview) {
          failNextPreview = false;
          return Promise.reject(new TypeError('preview offline'));
        }
        return originalFetch(url, options);
      };
      document.querySelector('.source-field').editorController.setExternalValue(arguments[0]);
    JAVASCRIPT
    click_on "Visual"

    assert_selector ".editor-projection", text: "Old first block"
    assert_selector '.editor-projection[aria-busy="true"]'
    assert_no_selector '.editor-projection [contenteditable="true"]'
    assert_selector '[data-presentation-editor-action="add-slide-after"]:disabled'
    assert_field "Markdown source", with: updated

    page.execute_script(<<~JAVASCRIPT)
      const staleBlock = document.querySelector('.editor-projection [data-editor-block-id]');
      staleBlock.textContent = 'Stale-map injection';
      staleBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Stale-map injection' }));
      const form = document.querySelector('form.visual-editor-form');
      form.previewController.delayValue = 0;
      form.previewController.retry();
    JAVASCRIPT
    assert_selector '[data-preview-target="status"]', text: "Preview unavailable", wait: 5
    assert_selector ".editor-projection", text: "Old first block"
    assert_selector '.editor-projection[aria-busy="false"]'
    assert_no_selector '.editor-projection [contenteditable="true"]'
    assert_selector '[data-presentation-editor-action="add-slide-after"]:disabled'
    assert_field "Markdown source", with: updated

    click_on "Retry preview"
    assert_selector ".presentation-editor-projection .slide", count: 3, wait: 5
    title_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('form.visual-editor-form');
        const title = [...document.querySelectorAll('.editor-projection .slide-block')].find((block) => block.textContent.includes('New A'));
        return {
          mode: form.dataset.editorMode,
          fresh: form.previewController.projectionFresh,
          sourceEditable: title?.dataset.editorSourceEditable,
          contentEditable: title?.getAttribute('contenteditable'),
          slideCount: form.presentationEditorController.map.slides.length,
          mapTitleEditable: form.presentationEditorController.map.slides[0].editable_regions[0].editable
        };
      })()
    JAVASCRIPT
    assert_equal "visual", title_state["mode"], title_state.inspect
    assert_equal true, title_state["fresh"], title_state.inspect
    assert_equal "true", title_state["sourceEditable"], title_state.inspect
…13866 tokens truncated….resize_to(width, 1000)
      assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=,
        page.evaluate_script("window.innerWidth")
      find('.lineage-navigation').scroll_to(:center)
      assert_selector 'button[aria-label="Zoom out"]', visible: true
      find('button[aria-label="Zoom out"]').click
      assert_selector '[data-lineage-graph-target="scaleLabel"]', text: "85%"
      find('button[aria-label="Reset graph view"]').click
      assert_timeline_geometry
    end

    search = find('input[aria-label="Find a presentation"]')
    search.set("Quarterly Review June")
    search.send_keys(:arrow_down)
    assert_equal "Quarterly Review June · 2026-01-08", page.evaluate_script("document.activeElement.textContent")
    send_keys :escape
    assert_selector '.lineage-search-results', visible: :hidden
    assert_equal "Find a presentation", page.evaluate_script("document.activeElement.getAttribute('aria-label')")
    search.set("No such presentation")
    assert_text "No matching presentations."
    search.set("Quarterly Review June")
    search.send_keys(:arrow_down, :enter)
    assert_selector ".lineage-node.is-located"
    page.execute_script("document.querySelector('.lineage-node.is-located').scrollIntoView({block: 'center'})")

    within("article", match: :first) do
      find(".library-card-menu-trigger").click
      find('summary', text: "Rename").click
      assert_selector '.library-rename input[type="text"]', visible: true
      page.execute_script("document.querySelector('.rename-menu[open]').scrollIntoView({block: 'center'})")
      find('summary', text: "Rename").click
      find('summary', text: "Fork").click
      assert_selector 'button', text: "As inspiration", visible: true
      page.execute_script("document.querySelector('.fork-menu[open]').scrollIntoView({block: 'center'})")
    end
    assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=,
      page.evaluate_script("window.innerWidth")
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "shows the seeded lineage tree in the library" do
    Presentation.delete_all
    Presentations::LineageSampleData.load!

    visit presentations_path

    assert_selector ".lineage-graph .lineage-node", count: 15
    assert_selector ".lineage-continuation"
    assert_selector ".lineage-inspiration"
    assert_equal 12, page.evaluate_script("document.querySelectorAll('.lineage-edge').length")
    assert_equal 15, page.evaluate_script("document.querySelectorAll('.lineage-node[data-lineage-graph-created-at]').length")
    assert_equal 3, page.evaluate_script("document.querySelectorAll('.lineage-date-tick').length")
    assert_equal 0, page.evaluate_script("document.querySelectorAll('.lineage-node[data-dragged]').length")
    assert_timeline_geometry
    find('button[aria-label="Zoom out"]').click
    assert_timeline_geometry
    click_on "Overview"
    assert_timeline_geometry
    find('button[aria-label="Reset graph view"]').click
    page.driver.browser.manage.window.resize_to(780, 900)
    find('select[aria-label="Jump to creation date"] option[value="2026-01-15"]').select_option
    assert_operator page.evaluate_script("document.querySelector('.lineage-timeline-scroll').scrollLeft"), :>, 0
    assert_timeline_geometry
    page.driver.browser.manage.window.resize_to(1400, 1000)
    find('input[aria-label="Find a presentation"]').set("Quarterly Review June")
    within(".lineage-search-results") { find("button", text: "Quarterly Review June").click }
    assert_selector ".lineage-node.is-located"
    find('a[aria-label="Open Quarterly Review June"]').click
    assert_field "Markdown source", with: /Quarterly Review June/
  end

  test "navigates a large same-day timeline without overlapping slides" do
    Presentation.delete_all
    created = Time.utc(2026, 9, 1, 10)
    12.times do |family|
      parent = Presentation.create!(title: "Family #{family}", source: "# Family #{family}", created_at: created)
      5.times do |generation|
        child = parent.fork_as("continuation")
        child.title = "Family #{family} revision #{generation}"
        child.created_at = created
        child.save!
        if generation == 2
          inspiration = parent.fork_as("inspiration")
          inspiration.title = "Family #{family} workshop"
          inspiration.created_at = created
          inspiration.save!
        end
        parent = child
      end
    end
    visit presentations_path
    assert_selector ".lineage-node", count: 84
    assert_selector ".lineage-date-tick", count: 1
    assert_timeline_geometry
    find('input[aria-label="Find a presentation"]').set("Family 11 revision 4")
    find(".lineage-search-results button", text: "Family 11 revision 4").click
    assert_selector ".lineage-node.is-located"
    page.driver.browser.manage.window.resize_to(780, 900)
    assert_timeline_geometry
    find('a[aria-label="Open Family 11 revision 4"]').click
    assert_field "Title", with: "Family 11 revision 4"
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "preserves a 16:9 slide surface across views" do
    parent = Presentation.create!(title: "Ratio deck", source: "# First slide\n\nContent\n---\n# Second slide")
    child = parent.fork_as("continuation")
    child.save!

    visit presentation_path(parent)
    assert_selector '.slides .slide', count: 2
    preview_ratio = page.evaluate_script("(function(){ const r = document.querySelector('.slides .slide').getBoundingClientRect(); return r.width / r.height })()")

    visit present_presentation_path(parent)
    assert_selector '.presentation-slide.slide', visible: true
    presentation_ratio = page.evaluate_script("(function(){ const r = document.querySelector('.presentation-slide.slide').getBoundingClientRect(); return r.width / r.height })()")

    visit presentations_path
    assert_selector ".lineage-node[data-lineage-graph-id='#{parent.id}'] .slide"
    lineage_ratio = page.evaluate_script("(function(){ const r = document.querySelector(\"[data-lineage-graph-id='#{parent.id}'] .slide\").getBoundingClientRect(); return r.width / r.height })()")

    assert_in_delta 16.0 / 9.0, preview_ratio, 0.02
    assert_in_delta preview_ratio, presentation_ratio, 0.02
    assert_in_delta preview_ratio, lineage_ratio, 0.02
  end

  test "renders the code and math sample with block display math" do
    Presentations::SampleData.load!

    visit presentations_path
    within("article", text: "Sample: Code and LaTeX math") do
      click_on "Preview"
    end

    assert_current_path %r{/presentations/\d+}, wait: 5
    assert_selector ".presentation-surface .slide", visible: true, wait: 5
    assert_selector ".katex", count: 4, visible: true
    assert_selector ".katex-display", visible: true
    assert_selector ".katex-html", visible: true
    assert_selector ".mfrac .frac-line", visible: true
    assert_selector ".msupsub", visible: true
    assert_text "$not_math$"
    assert_no_selector ".math-error"
    assert_equal "block",
      page.evaluate_script("getComputedStyle(document.querySelector('.katex-display')).display")
    assert_equal "absolute",
      page.evaluate_script("getComputedStyle(document.querySelector('.katex-mathml')).position")
    fraction_parts = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".mfrac > .vlist-t > .vlist-r:first-child > .vlist > span > .mord")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      })
    JAVASCRIPT
    assert_operator fraction_parts.length, :>=, 2
    assert_operator (fraction_parts[1]["top"] - fraction_parts[0]["top"]).abs, :>, 1
  end

  test "keeps Elef UI and presentation surfaces as separate styling zones" do
    presentation = Presentation.create!(title: "Scoped Deck", source: "# Scoped\n\n- One\n- Two")

    visit presentations_path
    assert_selector "body.elef-app"
    refute_selector "body.presentation-body"

    visit presentation_path(presentation)
    assert_selector "body.elef-app"
    assert_selector ".presentation-surface"
    assert_equal "disc",
      page.evaluate_script("getComputedStyle(document.querySelector('.presentation-surface ul')).listStyleType")

    visit present_presentation_path(presentation)
    assert_selector "body.presentation-body"
    assert_selector ".presentation-mode.presentation-surface"
    refute_selector "body.elef-app"
  end

  test "starts every regular slide header at the same inset" do
    presentation = Presentation.create!(
      title: "Header alignment",
      source: "# Short slide\n\nA short body.\n---\n# Code-heavy slide\n\n```ruby\n#{'  ' * 2}records.each { |record| process(record) }\n#{'  ' * 2}records.each { |record| process(record) }\n```\n\nAdditional body content."
    )

    visit presentation_path(presentation)

    header_offsets = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".slide")].map((slide) => {
        const header = slide.querySelector("h1");
        const slideRect = slide.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        return headerRect.top - slideRect.top;
      })
    JAVASCRIPT

    assert_equal 2, header_offsets.length
    assert_in_delta header_offsets.first, header_offsets.last, 0.001
  end

  test "user creates saves and reopens a markdown presentation" do
    visit presentations_path
    find("summary", text: "New").click
    within ".new-work-panel" do
      click_on "Presentation"
    end

    fill_in "Title", with: "System Deck"
    source = "# First\n\nBody\n---\n# Second"
    select "Book", from: "Typography"
    normalized_source = "---\ntypography: book\n---\n#{source}"
    fill_in "Markdown source", with: source
    click_on "Save presentation"

    assert_current_path %r{/presentations/\d+/edit}
    assert_text "Presentation saved."
    assert_field "Markdown source", with: normalized_source
    assert_selector ".editor-projection .slide", count: 2

    click_on "Library"
    click_on "System Deck"
    assert_field "Markdown source", with: normalized_source
  end

  test "presenting warns before leaving unsaved edits" do
    presentation = Presentation.create!(title: "Guarded presentation", source: "# Saved source")

    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Unsaved source"
    dismiss_confirm { click_on "Present" }

    assert_current_path edit_presentation_path(presentation)
    assert_field "Markdown source", with: "# Unsaved source"

    accept_confirm { click_on "Present" }
    assert_current_path present_presentation_path(presentation)
    assert_selector ".presentation-slide", text: "Saved source"
    assert_no_selector ".presentation-slide", text: "Unsaved source"
  end

  test "dirty source warns before navigation and cancel preserves edits" do
    presentation = Presentation.create!(title: "Dirty Deck", source: "# Saved")

    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Unsaved"

    dismiss_confirm do
      click_on "Library"
    end

    assert_current_path edit_presentation_path(presentation)
    assert_field "Markdown source", with: "# Unsaved"
  end

  test "presentation mode advances with keyboard" do
    presentation = Presentation.create!(title: "Presenter", source: "# One\n---\n# Two")

    visit present_presentation_path(presentation)
    assert_text "1 / 2"
    assert_selector ".presentation-slide", text: "One", visible: :visible

    send_keys :arrow_right
    assert_text "2 / 2"
    assert_selector ".presentation-slide", text: "Two", visible: :visible

    send_keys :arrow_left
    assert_text "1 / 2"
  end

  test "presentation keyboard shortcuts do not hijack toolbar activation" do
    presentation = Presentation.create!(title: "Keyboard exit", source: "# One")

    visit present_presentation_path(presentation)
    find("a", text: "Exit").send_keys(:enter)

    assert_current_path presentation_path(presentation)
  end

  test "inserts a fuzzy snippet and moves through its placeholder" do
    Snippet.create!(name: "Block equation", trigger: "beq", description: "A block LaTeX equation", category: "LaTeX", body: "$$\n${1:equation}\n$$")
    presentation = Presentation.create!(title: "Snippet deck", source: "# Math\n\n:")

    visit edit_presentation_path(presentation)
    source = find_field("Markdown source")
    editor = find(".cm-content")
    editor.send_keys("beq")
    assert_selector ".snippet-palette", visible: true
    assert_text ":beq"
    assert_selector ".snippet-option[aria-selected='true']"
    assert_equal "true", page.evaluate_script("document.querySelector('.cm-editor').getAttribute('aria-expanded')")
    palette_position = page.evaluate_script("(() => { const element = document.querySelector('[data-controller~=editor]'); const editor = element.editorController; const caret = editor.view.coordsAtPos(editor.selectionStart); const palette = document.querySelector('[data-snippet-palette-target=palette]').getBoundingClientRect(); return { belowCaret: Math.abs(palette.top - caret.bottom - 4) < 2, aboveCaret: Math.abs(palette.bottom - caret.top + 4) < 2, paletteBottom: palette.bottom, viewportBottom: window.innerHeight }; })()")
    assert palette_position["belowCaret"] || palette_position["aboveCaret"], "The snippet popup should stay next to the caret"
    assert_operator palette_position["paletteBottom"], :<, palette_position["viewportBottom"]

    editor.send_keys(:enter)
    assert_equal "# Math\n\n$$\nequation\n$$", source.value
    assert_equal "equation", page.evaluate_script("(() => { const e = document.querySelector('[data-snippet-palette-target=editor]'); return e.value.slice(e.selectionStart, e.selectionEnd) })()")
  end

  test "keeps multiple snippet placeholders aligned while tabbing" do
    Snippet.create!(name: "Two fields", trigger: "twice", description: "Two tab stops", category: "Markdown", body: "A ${1:first} B ${2:second}")
    presentation = Presentation.create!(title: "Multiple stops", source: "# Snippets\n\n:")

    visit edit_presentation_path(presentation)
    source = find_field("Markdown source")
    source.send_keys("twice")
    source.send_keys(:enter)

    selected_text = "(() => { const e = document.querySelector('[data-snippet-palette-target=editor]'); return e.value.slice(e.selectionStart, e.selectionEnd) })()"
    assert_equal "first", page.evaluate_script(selected_text)
    find(".cm-content").send_keys(:tab)
    assert_equal "second", page.evaluate_script(selected_text)
  end

  test "positions the palette when only the colon trigger is typed" do
    Snippet.create!(name: "Equation", trigger: "beq", category: "LaTeX", body: "x")
    visit new_presentation_path
    source = find_field("Markdown source")
    source.fill_in with: "# Math\n\n"
    source.send_keys(":")
    assert_selector ".snippet-option", text: ":beq"
    bounds = page.evaluate_script(<<~JS)
      (() => {
        const element = document.querySelector('[data-controller~="editor"]');
        const editor = element.editorController;
        const palette = document.querySelector('.snippet-palette');
        const caret = editor.view.coordsAtPos(editor.selectionStart), p = palette.getBoundingClientRect();
        return { positioned: palette.style.top !== '', belowCaret: Math.abs(p.top - caret.bottom - 4) < 2, aboveCaret: Math.abs(p.bottom - caret.top + 4) < 2, bottom: p.bottom, viewportBottom: window.innerHeight };
      })()
    JS
    assert bounds["positioned"], "The colon popup must receive caret coordinates before a query is typed"
    assert bounds["belowCaret"] || bounds["aboveCaret"], "The snippet popup should stay next to the caret"
    assert_operator bounds["bottom"], :<, bounds["viewportBottom"]
  end

  test "renders untrusted snippet metadata as text" do
    Snippet.create!(name: '<img src=x onerror="alert(1)">', trigger: "unsafe", description: "Untrusted", category: "Markdown", body: "text")
    presentation = Presentation.create!(title: "Safe snippets", source: "# Safe\n\n:")

    visit edit_presentation_path(presentation)
    source = find_field("Markdown source")
    source.send_keys("unsafe")

    assert_selector ".snippet-option span", text: '<img src=x onerror="alert(1)"> · Markdown'
    assert_no_selector ".snippet-option img"
  end

  test "keeps slide geometry fixed while scaling the canvas" do
    presentation = Presentation.create!(
      title: "Static geometry",
      source: "# A fixed heading\n\nA paragraph with enough content to establish a stable line break in the design canvas."
    )

    visit presentation_path(presentation)

    geometry = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const frame = document.querySelector('.slide-frame');
        const slide = frame.querySelector('.slide');
        const heading = slide.querySelector('h1');
        return {
          frameRatio: frame.getBoundingClientRect().width / frame.getBoundingClientRect().height,
          slideWidth: slide.offsetWidth,
          slideHeight: slide.offsetHeight,
          headingFontSize: getComputedStyle(heading).fontSize,
          scale: Number.parseFloat(getComputedStyle(slide).getPropertyValue('--slide-scale'))
        };
      })()
    JAVASCRIPT

    assert_in_delta 16.0 / 9, geometry["frameRatio"], 0.01
    assert_equal 1280, geometry["slideWidth"]
    assert_equal 720, geometry["slideHeight"]
    assert_equal "112px", geometry["headingFontSize"]
    assert_operator geometry["scale"], :>, 0

    page.execute_script("document.querySelector('.slide-frame').style.width = '640px'")
    page.evaluate_async_script("window.requestAnimationFrame(() => arguments[0]())")
    resized_scale = page.evaluate_script("Number.parseFloat(getComputedStyle(document.querySelector('.slide')).getPropertyValue('--slide-scale'))")

    assert_operator resized_scale, :<, geometry["scale"]
    assert_equal 1280, page.evaluate_script("document.querySelector('.slide').offsetWidth")
    assert_equal 720, page.evaluate_script("document.querySelector('.slide').offsetHeight")
    assert_equal "112px", page.evaluate_script("getComputedStyle(document.querySelector('.slide h1')).fontSize")
  end

  test "new presentation allows uploading dummy images to blank slides in Markdown and visual editor with rendering and folder sync" do
    require "zlib"
    generate_test_png = lambda do |width, height|
      raw = []
      height.times do
        raw << 0
        width.times { raw.push(70, 130, 210, 255) }
      end
      compressed = Zlib::Deflate.deflate(raw.pack("C*"))
      png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].pack("C*")
      ihdr = [width, height, 8, 6, 0, 0, 0].pack("NNCCCCC")
      png << [ihdr.bytesize].pack("N") << "IHDR" << ihdr << [Zlib.crc32("IHDR" + ihdr)].pack("N")
      png << [compressed.bytesize].pack("N") << "IDAT" << compressed << [Zlib.crc32("IDAT" + compressed)].pack("N")
      png << [0].pack("N") << "IEND" << [Zlib.crc32("IEND")].pack("N")
      png
    end

    image_one_file = Tempfile.new(["dummy_stock_photo", ".png"])
    image_one_file.binmode
    image_one_file.write(generate_test_png.call(120, 80))
    image_one_file.flush

    image_two_file = Tempfile.new(["dummy_screenshot", ".png"])
    image_two_file.binmode
    image_two_file.write(generate_test_png.call(160, 90))
    image_two_file.flush

    visit new_presentation_path
    assert_selector ".editor-shell", wait: 8

    # Switch to Source (Markdown) mode
    click_on "Source"
    assert_selector ".editor-mode-button[data-editor-target='sourceButton'][aria-pressed='true']", wait: 8

    # Create a presentation with a blank slide between slide 1 and slide 3
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.replaceRange(
        "# Intro slide\\n\\n---\\n\\n---\\n# Outro slide",
        0,
        editor.value.length
      );
    JAVASCRIPT

    # Position cursor on the blank slide
    blank_slide_pos = page.evaluate_script("document.querySelector('.source-field').editorController.value.indexOf('---') + 4")
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(#{blank_slide_pos})")

    # Upload first dummy image while in Markdown mode on the blank slide
    page.execute_script("document.querySelector('[data-media-target=input]').hidden = false")
    find('[data-media-target="input"]').set(image_one_file.path)

    # Verify upload status and Markdown insertion
    assert_selector ".media-upload-status", text: /dummy_stock_photo.*added to the Markdown source/i, wait: 8
    source_val = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    assert_includes source_val, "elef-asset:"

    # Verify rendering of the image on the blank slide
    assert_selector ".preview-pane .slide-image img.presentation-media", wait: 8
    natural_width = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const img = document.querySelector(".preview-pane .slide-image img.presentation-media");
        return img ? img.naturalWidth : 0;
      })()
    JAVASCRIPT
    assert_operator natural_width, :>, 0, "Uploaded image should render with positive naturalWidth in Markdown mode"

    # Switch to Visual mode
    click_on "Visual"
    assert_selector ".editor-mode-button[data-editor-target='visualButton'][aria-pressed='true']", wait: 8

    # Append a blank slide
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.replaceRange(editor.value + "\\n---\\n", 0, editor.value.length);
    JAVASCRIPT

    # Wait for the empty slide to appear in visual mode with Add image button
    assert_selector ".preview-pane .empty-slide-add-image", wait: 8

    # Click Add image on the blank slide in the visual editor
    find(".preview-pane .empty-slide-add-image", match: :first).click
    find('[data-media-target="input"]').set(image_two_file.path)

    # Verify upload of second dummy image onto the blank slide in the visual editor
    assert_selector ".media-upload-status", text: /dummy_screenshot.*added to the Markdown source/i, wait: 8
    assert_selector ".preview-pane img.presentation-media", minimum: 2, wait: 8

    second_img_width = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const imgs = document.querySelectorAll(".preview-pane img.presentation-media");
        const lastImg = imgs[imgs.length - 1];
        return lastImg ? lastImg.naturalWidth : 0;
      })()
    JAVASCRIPT
    assert_operator second_img_width, :>, 0, "Uploaded image should render with positive naturalWidth in Visual Editor mode"

    # Wait for autosave to ensure persistence
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 8

    # Verify folder storage on disk next to presentation.md
    presentation = Presentation.last
    storage_dir = presentation.storage_dir
    assert File.exist?(storage_dir.join("presentation.md")), "presentation.md should be saved in presentation folder"
    assert File.exist?(storage_dir.join("source.md")), "source.md should be saved in presentation folder"
    assert Dir.exist?(storage_dir.join("assets")), "assets/ directory should exist next to presentation.md"

    portable_content = File.read(storage_dir.join("presentation.md"))
    assert_includes portable_content, "assets/dummy_stock_photo", "presentation.md should reference assets folder"
    assert_includes portable_content, "assets/dummy_screenshot", "presentation.md should reference assets folder"

    assert File.exist?(storage_dir.join("assets/#{File.basename(image_one_file.path)}"))
    assert File.exist?(storage_dir.join("assets/#{File.basename(image_two_file.path)}"))
  ensure
    image_one_file&.close!
    image_two_file&.close!
  end
end
