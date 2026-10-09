require "application_system_test_case"
require "base64"
require "stringio"
require "tempfile"

class PresentationsTest < ApplicationSystemTestCase
  def primary_modifier
    RUBY_PLATFORM.match?(/darwin/) ? :meta : :control
  end

  def snippet_stop_marks
    page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".cm-snippet-stop")].map((mark) => mark.textContent)
    JAVASCRIPT
  end

  def active_snippet_stop
    page.evaluate_script('document.querySelector(".cm-snippet-stop-active")?.textContent ?? null')
  end

  def snippet_stop_positions
    page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector(".source-field").editorController;
        return [...document.querySelectorAll(".cm-snippet-stop")].map((mark) => editor.view.posAtDOM(mark));
      })()
    JAVASCRIPT
  end

  def active_snippet_stop_position
    page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector(".source-field").editorController;
        const mark = document.querySelector(".cm-snippet-stop-active");
        return mark ? editor.view.posAtDOM(mark) : null;
      })()
    JAVASCRIPT
  end

  def editor_selection
    <<~JAVASCRIPT
      (() => {
        const editor = document.querySelector(".source-field").editorController;
        return [editor.selectionStart, editor.selectionEnd];
      })()
    JAVASCRIPT
  end

  def wait_for_fresh_projection
    # The shared preview controller allows requests up to 8 seconds to finish.
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 10
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

  def wait_for_autosave_idle
    idle = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const deadline = Date.now() + 5000;
      const wait = () => {
        const form = document.querySelector('form[data-controller~="autosave"]');
        const controller = form && window.Stimulus.getControllerForElementAndIdentifier(form, "autosave");
        if (controller && !controller.flow.dirty && !controller.flow.saving) return done(true);
        if (Date.now() >= deadline) return done(false);
        window.setTimeout(wait, 10);
      };
      wait();
    JAVASCRIPT
    assert idle, "autosave did not reach an idle state"
  end

  test "appearance controls are collapsed in the presentation editor" do
    presentation = Presentation.create!(title: "Appearance popup", source: "# Appearance popup")

    visit edit_presentation_path(presentation)

    assert_selector "summary.editor-reveal-metadata", text: "Appearance", visible: true
    assert_no_selector "select#presentation_theme", visible: true
    assert_no_selector "select#presentation_typography", visible: true

    find("summary.editor-reveal-metadata", text: "Appearance").click
    assert_selector "select#presentation_theme", visible: true
    assert_selector "select#presentation_typography", visible: true

    panel_background = page.evaluate_script(
      'window.getComputedStyle(document.querySelector(".appearance-settings .editor-settings-panel")).backgroundColor'
    )
    assert_not_equal "rgba(0, 0, 0, 0)", panel_background
    assert_not_equal "transparent", panel_background
  end

  test "new presentation source positions its title explicitly and lets that position be changed" do
    expected_source = <<~MARKDOWN.chomp
      :::align{center center}
      # Untitled Document

      :::align {center}
      Start writing Markdown here.
    MARKDOWN

    visit new_presentation_path

    assert_field "Markdown source", with: expected_source
    assert_selector ".slide-statement .slide-block.position-center.position-middle", text: "Untitled Document", wait: 5
    assert_selector ".slide-statement .slide-block.position-center.position-top", text: "Start writing Markdown here."

    initial_alignment = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const title = document.querySelector('.slide-statement .slide-block.position-center.position-middle');
        const titleRect = title.getBoundingClientRect();
        const slideRect = title.closest('.slide').getBoundingClientRect();
        const style = getComputedStyle(title);
        return {
          alignSelf: style.alignSelf,
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
          titleCenterY: titleRect.top + titleRect.height / 2,
          slideCenterY: slideRect.top + slideRect.height / 2
        };
      })()
    JAVASCRIPT
    assert_equal "center", initial_alignment["alignSelf"]
    assert_equal initial_alignment["marginTop"], initial_alignment["marginBottom"]
    assert_in_delta initial_alignment["slideCenterY"], initial_alignment["titleCenterY"], 50

    find("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='0']").select("Bottom Right")
    assert_field "Markdown source", with: /:::align\{bottom right\}\n# Untitled Document/, wait: 5
    wait_for_fresh_projection
    assert_selector ".slide-statement .slide-block.position-right.position-bottom", text: "Untitled Document", wait: 5

    updated_alignment = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const title = document.querySelector('.slide-statement .slide-block.position-right.position-bottom');
        const style = getComputedStyle(title);
        return { alignSelf: style.alignSelf, textAlign: style.textAlign, marginTop: parseFloat(style.marginTop) };
      })()
    JAVASCRIPT
    assert_equal "flex-end", updated_alignment["alignSelf"]
    assert_equal "right", updated_alignment["textAlign"]
    assert_operator updated_alignment["marginTop"], :>, 0
  end

  test "layouts and themes sample preserves positions while adding and deleting blocks" do
    Presentations::SampleData.load!
    sample = Presentation.find_by!(sample_id: "layouts-and-themes")
    visit edit_presentation_path(sample)
    wait_for_fresh_projection

    assert_selector ".slide-statement .slide-block.position-center.position-middle", text: "Designing a visual system"
    assert_selector ".slide-statement .slide-block.position-center.position-top", text: /This deck exercises automatic layouts/

    find("select[data-presentation-editor-align][data-slide-index='2'][data-block-index='0']").select("Right")
    assert_field "Markdown source", with: /:::align\{right\}\n\n# Establish a visual contract/, wait: 5
    assert_selector ".slide-two-column .slide-title.slide-block.position-right.position-top", text: "Establish a visual contract", wait: 5

    find("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='0']").select("Bottom Right")
    assert_field "Markdown source", with: /:::align\{bottom right\}\n# Designing a visual system/, wait: 5
    assert_selector ".slide-statement .slide-block.position-right.position-bottom", text: "Designing a visual system", wait: 5

    find("[data-presentation-editor-action='add-block-after'][data-slide-index='0'][data-block-index='1']").click
    assert_field "Markdown source", with: /about consistent presentation design\.\n\nNew block/
    assert_selector ".slide[data-slide-index='0'] .slide-block", text: "New block", wait: 5
    accept_confirm("Delete this block?") do
      find("[data-presentation-editor-action='delete-block'][data-slide-index='0'][data-block-index='2']").click
    end
    wait_for_fresh_projection

    source = find_field("Markdown source").value
    assert_includes source, ":::align{bottom right}\n# Designing a visual system"
    assert_includes source, ":::align {center}\nThis deck exercises automatic layouts"
    refute_includes source, "New block"
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

  test "library preview images open Edit while Preview and menu controls stay usable" do
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

    within("#document_#{document.id}") { find(".library-card-preview-button").click }
    assert_current_path document_path(document)
    assert_selector ".document-surface h1", text: "Card document"

    visit root_path
    within("#presentation_#{presentation.id}") { find(".library-card-preview-button").click }
    assert_current_path presentation_path(presentation)
    assert_selector ".presentation-surface .slide", text: "Card deck"

    visit root_path
    [document, presentation].each do |work|
      within("##{work.is_a?(Document) ? 'document' : 'presentation'}_#{work.id}") do
        find(".library-card-menu-trigger").click
        assert_selector "details.library-card-menu[open]"
      end
      assert_current_path root_path
    end

    visit root_path
    find("#document_#{document.id} .library-card-open").click
    assert_current_path edit_document_path(document)

    visit root_path
    find("#presentation_#{presentation.id} .library-card-open").click
    assert_current_path edit_presentation_path(presentation)

    visit root_path
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
    wait_for_autosave_idle
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

  test "discarding a conflicted draft accepts the disk baseline without another save" do
    presentation = Presentation.create!(title: "Discard conflict", source: "# Initial")
    external_source = "# External version\n\nKeep the disk bytes.\n"

    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Local draft"
    wait_for_autosave_request(0)
    presentation.update!(source: external_source)
    page.execute_script("window.autosaveRequests[0].release()")

    assert_selector "[data-autosave-target='conflict']", visible: true
    click_button "Use current version"
    assert_no_selector "[data-autosave-target='conflict']", visible: true
    assert_field "Markdown source", with: external_source
    assert_selector "[data-autosave-target='status']", exact_text: "Saved"

    wait_for_autosave_idle
    assert_equal 1, page.evaluate_script("window.autosaveRequests.length")
    assert_equal external_source, presentation.reload.source
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
    wait_for_autosave_request(1)
    page.execute_script("window.autosaveRequests[1].release()")
    assert_text "Presentation saved."
    assert_selector '.preview-pane .slide', text: "Manual latest"
    assert_includes presentation.reload.source, "# Manual latest"
  end

  test "presents from the edit screen without submitting the editor form" do
    presentation = Presentation.create!(title: "Edit presentation", source: "# Original")

    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Unsaved editor change"
    wait_for_autosave_request(0)
    assert_equal true, page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('form[data-controller~="dirty"]');
        return window.Stimulus.getControllerForElementAndIdentifier(form, "dirty").dirty;
      })()
    JAVASCRIPT

    accept_confirm { click_on "Present" }

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

    find("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='1']").select("Center Center")
    assert_field "Markdown source", with: /:::align\{center center\}/, wait: 5

    click_on "Save presentation"
    assert_text "Presentation saved."
    visit edit_presentation_path(presentation)
    assert_field "Markdown source", with: /Changed/
    assert_selector ".presentation-editor-projection .slide", count: 2
  end

  test "visual presentation edits preserve source lines in a CRLF editor" do
    source = "# CRLF presentation\r\n\r\nOriginal visual block"
    expected = "# CRLF presentation\n\nFirst authored line\n\nSecond authored line"
    presentation = Presentation.create!(title: "CRLF presentation", source: source)

    visit edit_presentation_path(presentation, editor_mode: "source")
    assert_equal "\r\n", page.evaluate_script("document.querySelector('.source-field').editorController.lineSeparator")

    click_on "Visual"
    block = find(".editor-projection .slide-block", text: "Original visual block")
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      block.innerText = 'First authored line\\n\\nSecond authored line';
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' }));
    JAVASCRIPT

    assert_field "Markdown source", with: expected, wait: 5
    state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        const doc = editor.view.state.doc;
        return {
          source: editor.value,
          lines: Array.from({ length: doc.lines }, (_, index) => doc.line(index + 1).text)
        };
      })()
    JAVASCRIPT
    assert_equal expected, state["source"]
    assert_equal expected.split("\n"), state["lines"]
    page.execute_script("document.activeElement.blur()")
    wait_for_fresh_projection
    assert_selector ".editor-projection .slide-block", text: "First authored line"
    assert_selector ".editor-projection .slide-block", text: "Second authored line"
  end

  test "positions blocks in a new presentation through the visual control" do
    visit new_presentation_path
    wait_for_fresh_projection

    alignment = find("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='1']")
    alignment.select("Left")
    assert_field "Markdown source", with: /:::align\{left\}/, wait: 5

    wait_for_fresh_projection
    find("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='1']").select("Center Center")
    assert_field "Markdown source", with: /:::align\{center center\}/, wait: 5
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
    assert_equal "true", title_state["contentEditable"], title_state.inspect
    assert_selector ".editor-projection .slide-block[contenteditable='true']", text: "New A"
    assert_selector '[data-presentation-editor-action="add-slide-after"]:not(:disabled)'
    range_mismatches = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('form.visual-editor-form');
        const source = document.querySelector('.source-field').editorController.value;
        const map = form.presentationEditorController.map;
        return map.slides.flatMap((slide) => slide.blocks.filter((block) => {
          const raw = source.slice(block.source_range.start, block.source_range.end);
          return raw !== block.markdown && raw.replace(/\\r?\\n$/, '') !== block.markdown;
        }).map((block) => ({
          id: block.id,
          markdown: block.markdown,
          raw: source.slice(block.source_range.start, block.source_range.end),
          range: block.source_range
        })));
      })()
    JAVASCRIPT
    assert_empty range_mismatches, "installed editor map must describe the current source: #{range_mismatches.inspect}"

    click_on "Save presentation"
    assert_text "Presentation saved."
    visit edit_presentation_path(presentation)
    assert_field "Markdown source", with: updated
    refute_includes presentation.reload.source, "Stale-map injection"
  end

  test "keeps an unterminated presentation code fence read-only across save and reopen" do
    source = "# Code example\n\n```ruby\nputs 1"
    presentation = Presentation.create!(title: "Unterminated slide code", source: source)

    visit edit_presentation_path(presentation)

    assert_selector '.slide-block[data-editor-source-editable="false"][aria-readonly="true"] pre code', text: "puts 1"
    assert_no_selector '.slide-block[contenteditable="true"] pre'
    page.execute_script(<<~JAVASCRIPT)
      const block = document.querySelector('.slide-block[data-editor-source-editable="false"]');
      block.textContent = 'flattened code';
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'flattened code' }));
    JAVASCRIPT

    assert_field "Markdown source", with: source
    click_on "Save presentation"
    assert_text "Presentation saved."
    visit edit_presentation_path(presentation)

    assert_field "Markdown source", with: source
    assert_selector '.slide-block[data-editor-source-editable="false"][aria-readonly="true"] pre code', text: "puts 1"
  end

  test "presentation controls re-enable after repeated visual typing" do
    presentation = Presentation.create!(title: "Typing controls", source: "# Slide\n\nAlpha")

    visit edit_presentation_path(presentation)
    block = find(".editor-projection .slide-block", text: "Alpha")
    block.click
    block.send_keys(:end, " with several characters")

    assert_field "Markdown source", with: "# Slide\n\nAlpha with several characters", wait: 5
    page.execute_script("document.activeElement.blur()")
    wait_for_fresh_projection

    controls_reenabled = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('.visual-editor-form');
        const controller = form.presentationEditorController;
        const control = form.querySelector('[data-presentation-editor-action="add-block-after"][data-block-index="1"]');
        controller.setControlsDisabled(true);
        controller.setControlsDisabled(true);
        controller.setControlsDisabled(false);
        return !control.disabled;
      })()
    JAVASCRIPT
    assert controls_reenabled, "repeated pending updates must restore the original control state"

    assert_selector "[data-presentation-editor-action='add-block-after'][data-block-index='1']:not([disabled])", wait: 5
    find("[data-presentation-editor-action='add-block-after'][data-block-index='1']").click
    assert_field "Markdown source", with: "# Slide\n\nAlpha with several characters\n\nNew block", wait: 5
    assert_selector ".presentation-editor-projection .slide-block", text: "New block", wait: 5
  end

  test "single-block position directives move with their content and are deleted with it" do
    presentation = Presentation.create!(
      title: "Positioned structure",
      source: "# Slide\n\n:::align{center center}\n\nPositioned\n\nPlain"
    )

    visit edit_presentation_path(presentation)
    assert_selector ".slide-block.position-center.position-middle", text: "Positioned"
    refute_selector ".slide-block.position-center", text: "Plain"

    find("[data-presentation-editor-action='move-block-down'][data-block-index='1']").click
    assert_field "Markdown source", with: "# Slide\n\nPlain\n\n:::align{center center}\n\nPositioned", wait: 5
    wait_for_fresh_projection
    assert_selector ".slide-block.position-center.position-middle", text: "Positioned", wait: 5
    refute_selector ".slide-block.position-center", text: "Plain"

    assert_selector "[data-presentation-editor-action='add-block-after'][data-block-index='1']:not([disabled])", wait: 5
    find("[data-presentation-editor-action='add-block-after'][data-block-index='1']").click
    assert_field "Markdown source", with: "# Slide\n\nPlain\n\nNew block\n\n:::align{center center}\n\nPositioned", wait: 5
    wait_for_fresh_projection
    assert_selector ".slide-block", text: "New block", wait: 5
    refute_selector ".slide-block.position-center", text: "New block"

    accept_confirm do
      find("[data-presentation-editor-action='delete-block'][data-block-index='3']").click
    end
    wait_for_fresh_projection
    refute_includes find_field("Markdown source").value, ":::align{center center}"
    assert_no_selector ".slide-block.position-center", wait: 5

    click_on "Save presentation"
    assert_selector ".flash.notice", text: "Presentation saved.", wait: 10
    visit edit_presentation_path(presentation)
    assert_field "Markdown source", with: /# Slide\n\nPlain\n\nNew block/
    refute_includes find_field("Markdown source").value, ":::align{center center}"
  end

  test "blocks with position directives reorder independently without group restrictions" do
    presentation = Presentation.create!(
      title: "Position group",
      source: "# Slide\n\n:::align{center}\n\nFirst\n\nSecond\n\nOutside"
    )

    visit edit_presentation_path(presentation)
    assert_selector "[data-presentation-editor-action='move-block-down'][data-block-index='1']:not([disabled])"
    assert_selector "[data-presentation-editor-action='move-block-down'][data-block-index='2']:not([disabled])"
    assert_selector "[data-presentation-editor-action='move-block-up'][data-block-index='3']:not([disabled])"

    find("[data-presentation-editor-action='move-block-down'][data-block-index='1']").click
    assert_field "Markdown source", with: "# Slide\n\nSecond\n\n:::align{center}\n\nFirst\n\nOutside", wait: 5
    wait_for_fresh_projection
    assert_selector ".slide-block.position-center", text: "First", wait: 5
    refute_selector ".slide-block.position-center", text: "Second"

    assert_selector "[data-presentation-editor-action='delete-block'][data-block-index='2']:not([disabled])", wait: 5
    accept_confirm do
      find("[data-presentation-editor-action='delete-block'][data-block-index='2']").click
    end
    wait_for_fresh_projection
    final_source = find_field("Markdown source").value
    refute_includes final_source, ":::align{center}"
    assert_includes final_source, "Outside"
  end

  test "keeps rendered presentation blocks and source mappings atomic while editing structure" do
    presentation = Presentation.create!(title: "Live block structure", source: "# Live structure\n\nAlpha")

    visit edit_presentation_path(presentation)

    page.execute_script(<<~JAVASCRIPT)
      const block = [...document.querySelectorAll('.editor-projection .slide-block[contenteditable="true"]')]
        .find((candidate) => candidate.innerText === 'Alpha');
      block.focus();
      block.innerText = 'Alpha\\n\\nBeta';
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Beta' }));
    JAVASCRIPT

    assert_field "Markdown source", with: "# Live structure\n\nAlpha\n\nBeta", wait: 5
    assert_selector "[data-presentation-editor-action='delete-block']:disabled", count: 2
    pending = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const deadline = Date.now() + 5000;
      const check = () => {
        const preview = document.querySelector('.visual-editor-form')?.previewController;
        if (preview?.pendingProjection) return done(true);
        if (Date.now() >= deadline) return done(false);
        window.setTimeout(check, 10);
      };
      check();
    JAVASCRIPT
    assert pending, "server projection was not held while its editable block had focus"
    assert_selector ".slide-overview-actions button[disabled]"
    assert_selector ".slide-overview-card[disabled]"

    waiting_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('.visual-editor-form');
        const controller = form.presentationEditorController;
        const preview = form.previewController;
        return {
          renderedBlocks: document.querySelectorAll('.presentation-editor-projection [data-editor-block-id]').length,
          installedBlocks: controller.map.slides[0].blocks.length,
          pendingBlocks: preview.pendingProjection.payload.editor_map.slides[0].blocks.length
        };
      })()
    JAVASCRIPT
    assert_equal 2, waiting_state["renderedBlocks"]
    assert_equal 2, waiting_state["installedBlocks"]
    assert_equal 3, waiting_state["pendingBlocks"]
    page.execute_script("document.querySelector('[data-presentation-editor-action=\"delete-block\"][data-block-index=\"1\"]').click()")
    assert_field "Markdown source", with: "# Live structure\n\nAlpha\n\nBeta"

    page.execute_script("document.activeElement.blur()")

    assert_selector ".presentation-editor-projection [data-editor-block-id]", count: 3, wait: 5
    assert_no_selector ".slide-overview-actions button[aria-label='Add slide after selected'][disabled]"
    assert_no_selector ".slide-overview-actions button[aria-label='Duplicate selected slide'][disabled]"
    assert_no_selector ".slide-overview-actions button[aria-label='Delete selected slide'][disabled]"
    assert_no_selector ".slide-overview-card[disabled]"
    aligned_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('.visual-editor-form');
        const controller = form.presentationEditorController;
        return {
          renderedIds: [...document.querySelectorAll('.presentation-editor-projection [data-editor-block-id]')]
            .map((block) => block.dataset.editorBlockId),
          mappedIds: controller.map.slides[0].blocks.map((block) => block.id),
          sourceLength: controller.map.source_length
        };
      })()
    JAVASCRIPT
    assert_equal aligned_state["mappedIds"], aligned_state["renderedIds"]
    assert_equal find_field("Markdown source").value.length, aligned_state["sourceLength"]
    assert_selector "[data-presentation-editor-action='delete-block']:disabled", count: 0

    accept_confirm do
      find("[data-presentation-editor-action='delete-block'][data-slide-index='0'][data-block-index='1']").click
    end
    assert_field "Markdown source", with: "# Live structure\n\nBeta", wait: 5

    click_on "Save presentation"
    assert_text "Presentation saved."
    visit edit_presentation_path(presentation)
    assert_field "Markdown source", with: "# Live structure\n\nBeta"
    assert_selector ".presentation-editor-projection [data-editor-block-id]", count: 2
  end

  test "keeps the last-good presentation map paired with its projection after render failure" do
    presentation = Presentation.create!(title: "Failed map", source: "# Original\n\nOne")
    visit edit_presentation_path(presentation)
    original_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('.visual-editor-form');
        return {
          sourceLength: form.presentationEditorController.map.source_length,
          renderedIds: [...document.querySelectorAll('.presentation-editor-projection [data-editor-block-id]')]
            .map((block) => block.dataset.editorBlockId)
        };
      })()
    JAVASCRIPT

    page.execute_script(<<~JAVASCRIPT)
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === 'POST' && String(url).includes('/preview')) {
          return Promise.resolve(new Response(JSON.stringify({
            html: null,
            warnings: ['Simulated invalid projection'],
            editor_map: { source_length: 0, slides: [] }
          }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# Changed\n\nOne\n\nTwo"
    assert_selector '[data-preview-target="status"]', text: "Preview unavailable", wait: 5
    failed_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector('.visual-editor-form');
        return {
          sourceLength: form.presentationEditorController.map.source_length,
          mappedIds: form.presentationEditorController.map.slides.flatMap((slide) => slide.blocks.map((block) => block.id)),
          renderedIds: [...document.querySelectorAll('.presentation-editor-projection [data-editor-block-id]')]
            .map((block) => block.dataset.editorBlockId),
          controlsPaused: [...form.querySelectorAll('[data-presentation-editor-action="add-block-after"]')]
            .some((control) => control.disabled)
        };
      })()
    JAVASCRIPT

    assert_equal original_state["sourceLength"], failed_state["sourceLength"]
    assert_equal original_state["renderedIds"], failed_state["mappedIds"]
    assert_equal original_state["renderedIds"], failed_state["renderedIds"]
    assert failed_state["controlsPaused"]
    assert_field "Markdown source", with: "# Changed\n\nOne\n\nTwo"
  end

  test "visual presentation edits preserve formatted headings and LaTeX" do
    presentation = Presentation.create!(
      title: "Preserved syntax",
      source: "# **Styled** deck\n\nBefore $\\frac{x}{y}$ and $$\\sum_{i=1}^{n} i$$ after."
    )

    visit edit_presentation_path(presentation)
    page.execute_script(<<~JAVASCRIPT)
      const heading = [...document.querySelectorAll('.editor-projection .slide-block')].find((block) => block.innerText.includes('Styled'));
      heading.focus();
      const strong = heading.querySelector('strong');
      if (strong) strong.textContent = 'Visual';
      else heading.textContent = heading.textContent.replace('Styled', 'Visual');
      heading.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Visual' }));
    JAVASCRIPT
    assert_field "Markdown source", with: "# **Visual** deck\n\nBefore $\\frac{x}{y}$ and $$\\sum_{i=1}^{n} i$$ after.", wait: 5
    page.execute_script("document.activeElement.blur()")
    wait_for_fresh_projection

    page.execute_script(<<~JAVASCRIPT)
      const block = [...document.querySelectorAll('.editor-projection .slide-block')].find((candidate) => candidate.querySelector('[data-editor-math-source]'));
      block.focus();
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && !node.textContent.includes('Before ')) {}
      node.textContent = node.textContent.replace('Before ', 'After ');
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'After' }));
    JAVASCRIPT
    assert_field "Markdown source", with: "# **Visual** deck\n\nAfter $\\frac{x}{y}$ and $$\\sum_{i=1}^{n} i$$ after.", wait: 5
  end

  test "latex visual mode enter and exit flow in presentation block" do
    presentation = Presentation.create!(
      title: "Math deck",
      source: "# Slide\n\nInitial text"
    )

    visit edit_presentation_path(presentation)
    block = find(".editor-projection .slide-block", text: "Initial text")
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
    block.send_keys(" $x=3$")
    assert_selector ".editor-projection .katex", text: "x=3", wait: 5

    # Hit left arrow to enter math mode at $x=3|$
    block.send_keys(:left)
    assert_selector ".editor-projection .editor-math-active", text: "$x=3$", wait: 5

    # Edit 3 -> 4
    block.send_keys(:backspace)
    block.send_keys("4")
    assert_selector ".editor-projection .editor-math-active", text: "$x=4$", wait: 5

    # Hit right arrow to exit math mode
    block.send_keys(:right)
    assert_selector ".editor-projection [data-editor-math-source='x=4']", wait: 5
    assert_no_selector ".editor-projection .editor-math-active"
    assert_field "Markdown source", with: "# Slide\n\nInitial text $x=4$", wait: 5
  end

  test "real visual keystrokes preserve the exact title source" do
    source = <<~MARKDOWN.chomp
      ---
      presentationTheme: light
      presentationTypography: modern
      ---
      # The State of Testing

      ## A field report on making ideas easier to shape, review, and revisit

      - **Prepared for:**
    MARKDOWN
    presentation = Presentation.create!(title: "Keystroke parity", source: source)

    visit edit_presentation_path(presentation)
    title = find(".editor-projection .slide-block", match: :first)
    page.execute_script(<<~JAVASCRIPT)
      const title = document.querySelector('.editor-projection .slide-block');
      title.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    JAVASCRIPT
    title.send_keys(primary_modifier, "a")
    title.send_keys("The State of Testing — Updated")

    assert_field "Markdown source", with: "---\npresentationTheme: light\npresentationTypography: modern\n---\n# The State of Testing — Updated\n\n## A field report on making ideas easier to shape, review, and revisit\n\n- **Prepared for:**", wait: 5
  end

  test "typing a Markdown heading into a new visual block preserves its line and source syntax" do
    presentation = Presentation.create!(title: "Heading keystrokes", source: "# Existing slide")
    source_presentation = Presentation.create!(title: "Source heading keystrokes", source: "# Existing slide")

    visit edit_presentation_path(presentation)
    find("[data-presentation-editor-action='add-block-after']").click
    block = find(".editor-projection .slide-block", text: "New block", wait: 5)
    block.click
    block.send_keys(primary_modifier, "a")
    block.send_keys("## Test")

    assert_field "Markdown source", with: "# Existing slide\n\n## Test", wait: 5
    assert_equal "true", page.evaluate_script("document.activeElement.closest('[contenteditable=true]') !== null").to_s

    page.execute_script("document.activeElement.blur()")
    assert_selector ".presentation-editor-projection h2", text: "Test", wait: 5
    click_on "Save presentation"
    assert_selector ".flash.notice", text: "Presentation saved.", wait: 10
    visit edit_presentation_path(presentation)
    assert_field "Markdown source", with: "# Existing slide\n\n## Test"

    visit edit_presentation_path(source_presentation)
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    find(".cm-content").send_keys(:end, :enter, :enter, "## Test")
    assert_field "Markdown source", with: "# Existing slide\n\n## Test", wait: 5
    click_on "Save presentation"
    assert_selector ".flash.notice", text: "Presentation saved.", wait: 10
    visit edit_presentation_path(source_presentation)
    assert_field "Markdown source", with: "# Existing slide\n\n## Test"
    assert_equal presentation.reload.source, source_presentation.reload.source
  end

  test "typing in visual and source modes produces identical presentation fixture Markdown" do
    fixture = Presentations::SampleData::SAMPLES.find { |sample| sample[:id] == "renderer-stress-test" }
    baseline = fixture.fetch(:source)
    operations = [
      [".slide-block", "Renderer stress test", "Renderer stress test", "Markdown renderer stress test"],
      [".slide-block", "deliberate kitchen-sink", "deliberate kitchen-sink", "focused kitchen-sink"],
      [".slide-block", "Text", "Text", "Words"],
      [".slide-block", "source remains editable;", "source remains editable;", "source stays editable;"],
      [".slide-block", "formula", "formula", "equation"],
      [".slide-block", "Model", "Model", "Domain"],
      [".editor-media-caption", "Stress-test diagram", "Stress-test diagram", "Regression diagram"]
    ]
    visual = Presentation.create!(title: "Visual fixture parity", source: baseline)
    source = Presentation.create!(title: "Source fixture parity", source: baseline)
    visual_expected = baseline.dup
    source_expected = baseline.dup

    visit edit_presentation_path(visual)
    operations.each do |selector, visible_text, source_text, replacement|
      type_visual_text(selector, visible_text, replacement)
      visual_expected.sub!(source_text, replacement)
      assert_field "Markdown source", with: visual_expected, wait: 5
      page.execute_script("document.activeElement.blur()")
      assert_selector selector, text: /#{Regexp.escape(replacement)}/, wait: 5
    end

    click_on "Save presentation"
    assert_selector ".flash.notice", text: "Presentation saved.", wait: 10
    visit edit_presentation_path(visual)
    assert_field "Markdown source", with: visual_expected

    visit edit_presentation_path(source)
    click_on "Source"
    operations.each do |_selector, _visible_text, source_text, replacement|
      type_source_text(source_expected, source_text, replacement)
      source_expected.sub!(source_text, replacement)
      assert_field "Markdown source", with: source_expected, wait: 5
    end

    click_on "Save presentation"
    assert_selector ".flash.notice", text: "Presentation saved.", wait: 10
    visit edit_presentation_path(source)
    assert_field "Markdown source", with: source_expected
    assert_equal visual_expected, source_expected
    assert_equal visual.reload.source, source.reload.source
  end

  test "CRLF autosave responses preserve source offsets for later visual edits" do
    presentation = Presentation.create!(
      title: "CRLF canonical source",
      source: "# Stable offsets\n\nFirst paragraph.\n\n## Later section\n\nFinal paragraph."
    )
    canonical_source = presentation.source.sub("First paragraph.", "Server-saved paragraph.")

    visit edit_presentation_path(presentation)
    page.execute_script(<<~JAVASCRIPT, canonical_source.gsub("\n", "\r\n"))
      const editor = document.querySelector(".source-field").editorController;
      editor.replaceServerSource(arguments[0]);
    JAVASCRIPT

    assert_field "Markdown source", with: canonical_source, wait: 5
    wait_for_fresh_projection
    lengths = page.execute_script(<<~JAVASCRIPT)
      const form = document.querySelector(".visual-editor-form");
      const editor = form.querySelector(".source-field").editorController;
      return {
        editor: editor.value.length,
        document: editor.view.state.doc.length,
        sourceMap: form.presentationEditorController.map.source_length
      };
    JAVASCRIPT
    assert_equal canonical_source.length, lengths.fetch("editor")
    assert_equal canonical_source.length, lengths.fetch("document")
    assert_equal canonical_source.length, lengths.fetch("sourceMap")

    type_visual_text(".slide-block", "Final paragraph.", "Edited final paragraph.")
    assert_field "Markdown source", with: canonical_source.sub("Final paragraph.", "Edited final paragraph."), wait: 5
  end

  test "new inline math renders before a visual block loses focus" do
    presentation = Presentation.create!(title: "Inline math typing", source: "# Math\n\nAn equation")

    visit edit_presentation_path(presentation)
    block = find(".editor-projection .slide-block", text: "An equation")
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
    assert_selector ".presentation-editor-projection .katex", text: "test", wait: 5
    assert_equal "true", page.evaluate_script("document.activeElement.closest('[contenteditable=true]') !== null").to_s
    block.send_keys(" and $$x^2$")
    assert_field "Markdown source", with: "# Math\n\nAn equation $test$ and $$x^2$", wait: 5
    block.send_keys("$")
    assert_field "Markdown source", with: "# Math\n\nAn equation $test$ and $$x^2$$", wait: 5
    assert_selector ".presentation-editor-projection .katex-display", wait: 5
    block.send_keys(" after")
    assert_field "Markdown source", with: "# Math\n\nAn equation $test$ and $$x^2$$ after", wait: 5

    click_on "Save presentation"
    assert_text "Presentation saved."
    visit edit_presentation_path(presentation)
    assert_field "Markdown source", with: "# Math\n\nAn equation $test$ and $$x^2$$ after"
    assert_selector ".presentation-editor-projection .katex", text: "test"
  end

  test "visual presentation editing keeps tables and media as Markdown structures" do
    presentation = Presentation.create!(
      title: "Rich deck",
      source: "# Rich\n\nA **message**.\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n![Old alt](/icon.svg)"
    )

    visit edit_presentation_path(presentation)

    page.execute_script(<<~JAVASCRIPT)
      const block = [...document.querySelectorAll('.editor-projection .slide-block')]
        .find((candidate) => candidate.querySelector('strong'));
      block.focus();
      block.querySelector('strong').innerText = 'updated';
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'updated' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /A \*\*updated\*\*\./, wait: 5
    page.execute_script("document.activeElement.blur()")
    assert_selector ".editor-projection .slide-block strong", text: "updated", wait: 5
    assert_no_selector 'form[data-preview-projection-stale="true"]', wait: 5

    page.execute_script(<<~JAVASCRIPT)
      const tableBlock = [...document.querySelectorAll('.editor-projection .slide-block')]
        .find((block) => block.querySelector('table'));
      tableBlock.focus();
      tableBlock.querySelector('tbody td').innerText = 'Updated';
      tableBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Updated' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /\| Updated \| Two \|/, wait: 5
    page.execute_script("document.activeElement.blur()")
    assert_selector ".editor-projection table", text: "Updated", wait: 5
    assert_no_selector 'form[data-preview-projection-stale="true"]', wait: 5

    page.execute_script(<<~JAVASCRIPT)
      const imageBlock = [...document.querySelectorAll('.editor-projection .slide-block')]
        .find((block) => block.querySelector('.editor-media-caption'));
      imageBlock.focus();
      const caption = imageBlock.querySelector('.editor-media-caption');
      caption.innerText = 'New alt';
      caption.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'New alt' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /!\[New alt\]\(\/icon\.svg\)/, wait: 5
    assert_includes find_field("Markdown source").value, "| Updated | Two |"
  end

  test "source mode keeps unsupported presentation directives available" do
    presentation = Presentation.create!(title: "Source fallback", source: "# Visible\n\n:::custom-directive{value}\n\nContent")

    visit edit_presentation_path(presentation)

    assert_equal "visual", page.evaluate_script("document.querySelector('form.visual-editor-form').dataset.editorMode")
    click_on "Source"
    assert_selector ".cm-content", visible: true
    assert_includes find_field("Markdown source").value, ":::custom-directive{value}"
    click_on "Visual"
    assert_selector ".presentation-editor-projection", visible: true
    assert_includes find_field("Markdown source").value, ":::custom-directive{value}"
  end

  test "visual presentation controls reorder blocks and slides without losing source text" do
    presentation = Presentation.create!(
      title: "Structural deck",
      source: "# First\n\nFirst block\n\nSecond block\n---\n# Second\n\nOther block"
    )

    visit edit_presentation_path(presentation)
    dismiss_confirm do
      find("[data-presentation-editor-action='delete-block'][data-slide-index='0'][data-block-index='1']").click
    end
    assert_field "Markdown source", with: "# First\n\nFirst block\n\nSecond block\n---\n# Second\n\nOther block"

    find("[data-presentation-editor-action='move-block-down'][data-slide-index='0'][data-block-index='1']").click
    assert_field "Markdown source", with: /# First\n\nSecond block\n\nFirst block/, wait: 5
    wait_for_fresh_projection
    assert_no_selector "[data-presentation-editor-action='add-block-after'][data-slide-index='0'][data-block-index='1'][disabled]", wait: 5

    find("[data-presentation-editor-action='add-block-after'][data-slide-index='0'][data-block-index='1']").click
    assert_field "Markdown source", with: /Second block\n\nNew block\n\nFirst block/, wait: 5
    wait_for_fresh_projection
    assert_no_selector "[data-presentation-editor-action='delete-block'][data-slide-index='0'][data-block-index='2'][disabled]", wait: 5

    accept_confirm { find("[data-presentation-editor-action='delete-block'][data-slide-index='0'][data-block-index='2']").click }
    assert_field "Markdown source", with: /Second block\n\nFirst block/, wait: 5
    wait_for_fresh_projection
    assert_no_selector "[data-presentation-editor-action='move-slide-down'][data-slide-index='0'][disabled]", wait: 5

    find("[data-presentation-editor-action='move-slide-down'][data-slide-index='0']").click
    assert_field "Markdown source", with: /# Second\n\nOther block\n---\n# First\n\nSecond block\n\nFirst block/, wait: 5
    wait_for_fresh_projection
  end

  test "Art block move and delete operations keep the directive with its root list" do
    original = "# Keep\n\nBefore\n\n:::art\n- Alpha\n- Beta\n\nAfter\n\nTail"
    presentation = Presentation.create!(title: "Art block ownership", source: original)

    visit edit_presentation_path(presentation)
    assert_selector ".presentation-editor-projection [data-elef-art-root] .elef-art-list > li", count: 2
    find("[data-presentation-editor-action='move-block-up'][data-block-index='2']").click
    assert_field "Markdown source", with: "# Keep\n\n:::art\n- Alpha\n- Beta\n\nBefore\n\nAfter\n\nTail", wait: 5
    wait_for_fresh_projection
    moved_source = find_field("Markdown source").value
    assert_equal ":::art\n- Alpha\n- Beta", moved_source.lines[2, 3].join.strip
    assert_includes moved_source, "\n\nAfter\n\nTail"
    refute_includes moved_source, "data-elef-art-root"

    accept_confirm do
      find("[data-presentation-editor-action='delete-block'][data-block-index='1']").click
    end
    assert_field "Markdown source", with: "# Keep\n\nBefore\n\nAfter\n\nTail", wait: 5
    wait_for_fresh_projection
    refute_includes find_field("Markdown source").value, ":::art"
    refute_selector ".presentation-editor-projection [data-elef-art-root]"
  end

  test "deleting Art before a single-block alignment group removes its directive too" do
    presentation = Presentation.create!(
      title: "Aligned Art block ownership",
      source: "# Slide\n\n:::art\n:::align{center}\n- Alpha\n\nNext paragraph"
    )

    visit edit_presentation_path(presentation)
    wait_for_fresh_projection
    assert_selector ".presentation-editor-projection [data-elef-art-root] .elef-art-list > li", count: 1

    accept_confirm do
      find("[data-presentation-editor-action='delete-block'][data-block-index='1']").click
    end

    assert_field "Markdown source", with: /# Slide\n\nNext paragraph/, wait: 5
    wait_for_fresh_projection
    refute_includes find_field("Markdown source").value, ":::art"
    refute_includes find_field("Markdown source").value, ":::align{center}"
    assert_no_selector ".presentation-editor-projection [data-elef-art-root]"
    assert_selector ".presentation-editor-projection p", text: "Next paragraph"
  end

  test "keeps the last good presentation projection when preview is unavailable and offers retry" do
    presentation = Presentation.create!(title: "Stable deck", source: "# Stable\n\nLast good slide")
    visit edit_presentation_path(presentation)
    assert_selector ".presentation-editor-projection .slide", text: "Last good slide"

    page.execute_script(<<~JAVASCRIPT)
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === "POST" && String(url).includes("/preview")) {
          window.fetch = originalFetch;
          return Promise.reject(new Error("Simulated preview outage"));
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# Broken\n\nNew slide text"
    assert_selector '[data-preview-target="status"]', text: "Preview unavailable", wait: 5
    assert_selector '[data-preview-target="warnings"]', text: "Preview could not be reached. Your source is still safe; try again shortly."
    assert_selector ".presentation-editor-projection .slide", text: "Last good slide"
    assert_no_selector ".presentation-editor-projection .slide", text: "New slide text"
    assert_field "Markdown source", with: "# Broken\n\nNew slide text"
    assert_selector "[data-presentation-editor-action='add-slide-after'][disabled]"
    assert_selector '[data-preview-target="retry"]', visible: true

    click_on "Retry preview"
    assert_selector ".presentation-editor-projection .slide", text: "New slide text", wait: 5
    assert_selector '[data-preview-target="warnings"]', visible: false
    assert_selector '[data-preview-target="retry"]', visible: false
    assert_no_selector "[data-presentation-editor-action='add-slide-after'][disabled]"
  end

  test "overview edits source ranges safely and slide operations undo as one edit" do
    original = "---\r\ntitle: Deck\r\n---\r\n# Café 😀\r\n\r\n```md\r\n---\r\n```\r\n---\r\n# Second\r\n---\r\n# Third"
    presentation = Presentation.create!(title: "Overview operations", source: original)

    visit edit_presentation_path(presentation)
    assert_selector ".slide-overview-card", count: 3
    assert_no_selector ".slide-overview-card [contenteditable='true']"
    assert_no_selector ".slide-overview-card .presentation-editor-block-controls"
    find('.slide-overview-card[data-slide-index="1"]').click
    find('button[aria-label="Duplicate selected slide"]').click
    assert_selector ".slide-overview-card", count: 4
    assert_no_selector ".slide-overview-actions button[disabled]", wait: 8
    find('button[aria-label="Move selected slide later"]').click
    assert_selector ".slide-overview-actions button:not([disabled])", minimum: 1, wait: 8

    source = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    assert source.start_with?("---\ntitle: Deck\n---\n")
    assert_includes source, "```md\n---\n```"
    assert_operator source.index("# Third"), :<, source.rindex("# Second"), source

    find('button[aria-label="Delete selected slide"]').click
    assert_selector ".slide-overview-card", count: 3
    assert_selector ".slide-overview-actions button:not([disabled])", minimum: 1, wait: 8
    before_add = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    find('button[aria-label="Add slide after selected"]').click
    assert_selector ".slide-overview-card", count: 4
    page.driver.browser.action.key_down(primary_modifier).send_keys("z").key_up(primary_modifier).perform
    assert_selector ".slide-overview-card", count: 3
    assert_selector ".slide-overview-actions button:not([disabled])", minimum: 1, wait: 8
    assert_equal before_add, page.evaluate_script("document.querySelector('.source-field').editorController.value")
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 8
    assert_equal before_add, presentation.reload.source.gsub(/\r\n|\r/, "\n")
    assert presentation.source.start_with?("---\r\ntitle: Deck\r\n---\r\n")
  end

  test "overflow warnings update after editing and media picker insertion uses canonical asset references" do
    dense = "# Dense slide\n\n" + ("A sentence with enough detail to occupy space. " * 280)
    presentation = Presentation.create!(title: "Overflow and media", source: dense)
    visit edit_presentation_path(presentation)
    assert_selector ".slide-overflow-warnings", visible: true, wait: 8
    assert_text "Slide 1 extends beyond its 16:9 frame."
    assert_selector ".slide-overview-card .is-overflowing"

    fill_in "Markdown source", with: "# Clear slide"
    assert_selector ".slide-overflow-warnings", visible: false, wait: 8

    media_file = Tempfile.new(["pixel", ".png"])
    media_file.binmode
    media_file.write(Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="))
    media_file.flush
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(document.querySelector('.source-field').editorController.value.length)")
    click_on "Add image or MP4"
    page.execute_script("document.querySelector('[data-media-target=input]').hidden = false")
    find('[data-media-target="input"]').set(media_file.path)

    assert_selector ".media-upload-status", text: /pixel.*added to the Markdown source/i, wait: 8
    assert_includes page.evaluate_script("document.querySelector('.source-field').editorController.value"), "elef-asset:"
    assert_selector ".preview-pane .presentation-media-contain", wait: 8
    assert_operator page.evaluate_script("document.querySelector('.preview-pane img.presentation-media').naturalWidth"), :>, 0
    assert_equal "image/png", presentation.reload.assets.blobs.last.content_type
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 8
    assert_includes presentation.reload.source, "elef-asset:"
  ensure
    media_file&.close!
  end

  test "a new presentation uploads and saves an image through Add image" do
    visit new_presentation_path
    media_file = Tempfile.new(["new-presentation-pixel", ".png"])
    media_file.binmode
    media_file.write(Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="))
    media_file.flush

    page.execute_script("window.mediaPickerClicks = 0; document.querySelector('[data-media-target=input]').click = () => { window.mediaPickerClicks++ }")
    click_on "Add image or MP4"
    assert_equal 1, page.evaluate_script("window.mediaPickerClicks")
    page.execute_script("document.querySelector('[data-media-target=input]').hidden = false")
    find('[data-media-target="input"]').set(media_file.path)

    assert_selector ".media-upload-status", text: /new-presentation-pixel.*added to the Markdown source/i, wait: 8
    assert_includes find_field("Markdown source").value, "elef-asset:"
    assert_selector ".preview-pane img.presentation-media", wait: 8
    assert_operator page.evaluate_script("document.querySelector('.preview-pane img.presentation-media').naturalWidth"), :>, 0
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 8
    assert_includes Presentation.order(:id).last.reload.source, "elef-asset:"
  ensure
    media_file&.close!
  end

  test "source mode pastes and drops local images at the cursor and keeps text paste working" do
    presentation = Presentation.create!(title: "Source image gestures", source: "# Source image gestures\n\nLead text.\n\nTail text.")
    visit edit_presentation_path(presentation, editor_mode: "source")
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="

    paste_result = page.execute_script(<<~JAVASCRIPT, png)
      const editor = document.querySelector('.source-field').editorController;
      const insertion = editor.value.indexOf('Tail text.');
      editor.setSelectionRange(insertion);
      editor.focus();
      const bytes = Uint8Array.from(atob(arguments[0]), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'pasted-presentation.png', { type: 'image/png' }));
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      editor.view.contentDOM.dispatchEvent(event);
      return { prevented: event.defaultPrevented, sourceMode: editor.editingMode };
    JAVASCRIPT
    assert_equal "source", paste_result["sourceMode"]
    assert paste_result["prevented"]
    assert_selector ".media-upload-status", text: /pasted-presentation\.png added to the Markdown source/i, wait: 8

    pasted_source = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    assert_operator pasted_source.index("Lead text."), :<, pasted_source.index("elef-asset:")
    assert_operator pasted_source.index("elef-asset:"), :<, pasted_source.index("Tail text.")
    assert_selector ".preview-pane img.presentation-media", count: 1, wait: 8
    assert_operator page.evaluate_script("document.querySelector('.preview-pane img.presentation-media').naturalWidth"), :>, 0

    drop_result = page.execute_script(<<~JAVASCRIPT, png)
      const editor = document.querySelector('.source-field').editorController;
      const insertion = editor.value.indexOf('Tail text.');
      const coordinates = editor.view.coordsAtPos(insertion);
      const resolvedPosition = editor.view.posAtCoords({ x: coordinates.left, y: (coordinates.top + coordinates.bottom) / 2 });
      const bytes = Uint8Array.from(atob(arguments[0]), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'dropped-presentation.png', { type: 'image/png' }));
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
      return { intendedPosition: insertion, resolvedPosition, dragoverPrevented: dragover.defaultPrevented, dropPrevented: drop.defaultPrevented };
    JAVASCRIPT
    assert drop_result["dragoverPrevented"], drop_result.inspect
    assert drop_result["dropPrevented"], drop_result.inspect
    assert_equal drop_result["intendedPosition"], drop_result["resolvedPosition"], drop_result.inspect
    assert_selector ".media-upload-status", text: /dropped-presentation\.png added to the Markdown source/i, wait: 8

    dropped_source = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    assert_equal 2, dropped_source.scan("elef-asset:").length
    assert_operator dropped_source.index("elef-asset:"), :<, dropped_source.rindex("elef-asset:")
    assert_operator dropped_source.rindex("elef-asset:"), :<, dropped_source.index("Tail text.")
    assert_selector ".preview-pane img.presentation-media", count: 2, wait: 8
    assert_equal 2, presentation.reload.assets.count
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 8

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

  test "source mode drops web images into presentation slides at the cursor" do
    presentation = Presentation.create!(title: "Web image presentation", source: "# Web image presentation\n\nLead text.\n\nTail text.")
    visit edit_presentation_path(presentation, editor_mode: "source")
    png_data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="

    drop_result = page.execute_script(<<~JAVASCRIPT, png_data_url)
      const editor = document.querySelector('.source-field').editorController;
      const insertion = editor.value.indexOf('Tail text.');
      const coordinates = editor.view.coordsAtPos(insertion);
      const resolvedPosition = editor.view.posAtCoords({ x: coordinates.left, y: (coordinates.top + coordinates.bottom) / 2 });
      const transfer = new DataTransfer();
      transfer.setData('text/uri-list', arguments[0]);
      transfer.setData('text/html', '<img src="' + arguments[0] + '">');
      const options = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: coordinates.left, clientY: (coordinates.top + coordinates.bottom) / 2 };
      const dragover = new DragEvent('dragover', options);
      const drop = new DragEvent('drop', options);
      editor.view.contentDOM.dispatchEvent(dragover);
      editor.view.contentDOM.dispatchEvent(drop);
      return {
        intendedPosition: insertion,
        resolvedPosition,
        dragoverPrevented: dragover.defaultPrevented,
        dropPrevented: drop.defaultPrevented
      };
    JAVASCRIPT

    assert drop_result["dragoverPrevented"], drop_result.inspect
    assert drop_result["dropPrevented"], drop_result.inspect
    assert_equal drop_result["intendedPosition"], drop_result["resolvedPosition"], drop_result.inspect
    assert_selector ".media-upload-status", text: /dropped-image\.png added to the Markdown source/i, wait: 8

    dropped_source = page.evaluate_script("document.querySelector('.source-field').editorController.value")
    assert_includes dropped_source, "elef-asset:"
    assert_operator dropped_source.index("Lead text."), :<, dropped_source.index("elef-asset:")
    assert_operator dropped_source.index("elef-asset:"), :<, dropped_source.index("Tail text.")
    assert_selector ".preview-pane img.presentation-media", count: 1, wait: 8
    assert_equal 1, presentation.reload.assets.count
  end

  test "published presentation print action produces a landscape PDF with one page per slide and attached media" do
    media_bytes = Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII=")
    media_digest = Digest::SHA256.hexdigest(media_bytes)
    published_source = "---\ntheme: dark\ntypography: technical\n---\n# Published one\n\n![Diagram](elef-asset:#{media_digest} \"fit:contain\")\n---\n# Published two"
    presentation = Presentation.create!(title: "Print workflow", source: published_source)
    presentation.assets.attach(io: StringIO.new(media_bytes), filename: "diagram.png", content_type: "image/png")
    blob = presentation.assets.blobs.last
    blob.update!(metadata: blob.metadata.merge("elef_sha256" => media_digest))
    PresentationReleasePublisher.call(presentation)
    presentation.update!(source: "---\ntheme: light\n---\n# Latest draft\n---\n# Draft two")

    visit print_presentation_path(presentation, version: "published")
    page.execute_script("window.print = () => { window.printWasRequested = true }")
    click_on "Print / Save PDF"
    assert_equal true, page.evaluate_script("window.printWasRequested")

    browser = page.driver.browser
    begin
      browser.execute_cdp("Emulation.setEmulatedMedia", media: "print")
      dimensions = page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const frame = document.querySelector('.presentation-print-slides > .slide-frame');
          const slide = frame.querySelector('.slide');
          return { frameWidth: frame.getBoundingClientRect().width, frameHeight: frame.getBoundingClientRect().height,
            slideWidth: slide.getBoundingClientRect().width, slideHeight: slide.getBoundingClientRect().height,
            pageBreak: getComputedStyle(frame).breakAfter };
        })()
      JAVASCRIPT
      assert_in_delta 1280, dimensions["frameWidth"], 2
      assert_in_delta 720, dimensions["frameHeight"], 2
      assert_in_delta 1280, dimensions["slideWidth"], 2
      assert_in_delta 720, dimensions["slideHeight"], 2
      assert_equal "page", dimensions["pageBreak"]

      printed_pdf = browser.execute_cdp("Page.printToPDF", printBackground: true, preferCSSPageSize: true)
      pdf_bytes = Base64.decode64(printed_pdf.fetch("data"))
      assert pdf_bytes.start_with?("%PDF-")
      assert_operator pdf_bytes.bytesize, :>, 1_000
      assert_equal 2, pdf_bytes.scan(%r{/Type\s*/Page\b}).length, "PDF should contain one page for each published slide"
      assert_match %r{/Subtype\s*/Image\b}, pdf_bytes, "PDF should contain the slide image media"
    ensure
      browser.execute_cdp("Emulation.setEmulatedMedia", media: "screen")
    end
    assert page.evaluate_script("window.matchMedia('screen').matches"), "print emulation should not leak into later system tests"
  end

  test "media can be pasted or dropped onto the preview" do
    presentation = Presentation.create!(title: "Media gestures", source: "# Media gestures")
    visit edit_presentation_path(presentation)
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII="
    page.execute_script(<<~JAVASCRIPT)
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob("#{png}"), character => character.charCodeAt(0));
      transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      document.querySelector(".editor-projection [data-editor-block-id][contenteditable='true']").dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true, cancelable: true, clipboardData: transfer
      }));
    JAVASCRIPT
    assert_selector ".media-upload-status", text: /pasted.*added to the Markdown source/i, wait: 8

    drag_result = page.execute_script(<<~JAVASCRIPT)
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob("#{png}"), character => character.charCodeAt(0));
      transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      const preview = document.querySelector(".preview-pane");
      const dragover = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer });
      const drop = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer });
      preview.dispatchEvent(dragover);
      preview.dispatchEvent(drop);
      return { files: drop.dataTransfer.files.length, types: [...drop.dataTransfer.types], status: document.querySelector(".media-upload-status").textContent,
        dragoverTypes: [...dragover.dataTransfer.types], dragoverPrevented: dragover.defaultPrevented, dropPrevented: drop.defaultPrevented,
        action: preview.getAttribute("data-action"),
        hasController: Boolean(window.Stimulus.getControllerForElementAndIdentifier(document.querySelector("form.visual-editor-form"), "media")) };
    JAVASCRIPT
    assert_equal 1, drag_result["files"]
    assert_includes drag_result["types"], "Files"
    assert drag_result["hasController"], drag_result.inspect
    assert drag_result["dragoverPrevented"], drag_result.inspect
    assert drag_result["dropPrevented"]
    assert_equal "Uploading dropped.png…", drag_result["status"]
    assert_selector ".media-upload-status", text: /dropped.*added to the Markdown source/i, wait: 8
    assert_selector ".editor-projection .presentation-media-contain", count: 2, wait: 8
    assert_equal 2, presentation.reload.assets.count
  end

  test "failed autosave can be retried and validation errors preserve saved source" do
    presentation = Presentation.create!(title: "Retry deck", source: "# Original")
    visit edit_presentation_path(presentation)
    page.execute_script(<<~JAVASCRIPT)
      const originalFetch = window.fetch.bind(window);
      window.fetchForSaveRetry = originalFetch;
      window.fetch = (url, options) => {
        if (options?.method !== 'PATCH') return originalFetch(url, options);
        return Promise.reject(new Error('Simulated connection failure'));
      };
    JAVASCRIPT
    fill_in "Markdown source", with: "# Recovered"
    assert_selector '[data-autosave-target="status"]', text: "Save failed"
    assert_equal "# Original", presentation.reload.source
    page.execute_script("window.fetch = window.fetchForSaveRetry")
    click_on "Retry save"
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved"
    assert_includes presentation.reload.source, "# Recovered"

    fill_in "Title", with: "x" * 121
    assert_selector '[data-autosave-target="status"]', text: "Save failed"
    assert_equal "Retry deck", presentation.reload.title
    fill_in "Title", with: "Valid title"
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved"
    assert_equal "Valid title", presentation.reload.title
  ensure
    page.execute_script("window.fetch = window.fetchForSaveRetry") if page
  end

  test "recovers the browser draft after an autosave outage and reload" do
    presentation = Presentation.create!(title: "Offline recovery", source: "# Original")
    visit edit_presentation_path(presentation)
    page.execute_script(<<~JAVASCRIPT)
      const originalFetch = window.fetch.bind(window);
      window.restoreSaveFetch = () => { window.fetch = originalFetch; };
      window.fetch = (url, options = {}) => {
        if (options.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# Offline edit"
    assert_selector '[data-autosave-target="status"]', text: "Save failed", wait: 5
    assert_equal "# Original", presentation.reload.source
    page.execute_script("window.restoreSaveFetch()")

    page.refresh

    assert_field "Markdown source", with: "# Offline edit", wait: 5
    assert_selector '[data-autosave-target="status"]', exact_text: "Recovered unsent changes", wait: 5
    assert_equal "# Offline edit", page.evaluate_script("document.querySelector('.source-field')?.editorController?.sourceValue")
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 5
    assert_includes presentation.reload.source, "# Offline edit"
  ensure
    page.execute_script("window.restoreSaveFetch?.()") if page
  end

  test "warns when autosave and both browser draft stores are unavailable" do
    presentation = Presentation.create!(title: "No browser storage", source: "# Original")
    visit edit_presentation_path(presentation)

    page.execute_script(<<~JAVASCRIPT)
      const controller = window.Stimulus.getControllerForElementAndIdentifier(
        document.querySelector('form[data-controller~="autosave"]'), 'autosave'
      );
      controller.database = Promise.resolve(null);
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('elef.draft.')) throw new DOMException('Storage is full', 'QuotaExceededError');
        return originalSetItem.call(this, key, value);
      };
      window.restoreDraftStorage = () => { Storage.prototype.setItem = originalSetItem; };
      const originalFetch = window.fetch.bind(window);
      window.restoreSaveFetch = () => { window.fetch = originalFetch; };
      window.fetch = (url, options = {}) => {
        if (options.method === 'PATCH') {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# Keep this open"
    assert_selector '[data-autosave-target="status"]', text: "Browser recovery is unavailable", wait: 5
    assert_selector '[data-autosave-target="status"]', text: "copy your changes before leaving", wait: 5
    assert_field "Markdown source", with: "# Keep this open"
    assert_equal "# Original", presentation.reload.source
  ensure
    page.execute_script("window.restoreDraftStorage?.(); window.restoreSaveFetch?.()") if page
  end

  test "times out a stalled autosave and lets the user retry the latest edit" do
    presentation = Presentation.create!(title: "Stalled save", source: "# Original")
    visit edit_presentation_path(presentation)
    page.execute_script(<<~JAVASCRIPT)
      const form = document.querySelector('form[data-controller~="autosave"]');
      form.setAttribute("data-autosave-timeout-value", "5000");
      window.saveStarted = false;
      window.fetchForSaveRetry = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === "PATCH") {
          window.saveStarted = true;
          return new Promise(() => {});
        }
        return window.fetchForSaveRetry(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# First edit"
    save_started = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const deadline = Date.now() + 5000;
      const waitForSave = () => {
        if (window.saveStarted) return done(true);
        if (Date.now() >= deadline) return done(false);
        window.setTimeout(waitForSave, 10);
      };
      waitForSave();
    JAVASCRIPT
    assert save_started, "autosave request did not start"

    # Keep the latest edit from starting another automatic request while the
    # intentionally stalled request times out and exposes its retry control.
    page.execute_script(<<~JAVASCRIPT)
      document.querySelector('form[data-controller~="autosave"]')
        .setAttribute("data-autosave-delay-value", "15000");
    JAVASCRIPT

    fill_in "Markdown source", with: "# Latest edit"
    assert_field "Markdown source", with: "# Latest edit"
    # Fire the field's change event before the failure state so clicking Retry
    # doesn't also trigger that field's blur event.
    page.execute_script("document.activeElement?.blur()")
    assert_selector '[data-autosave-target="status"]', text: "Save timed out", wait: 8
    assert_selector '[data-autosave-target="retry"]', visible: true
    assert_equal "# Original", presentation.reload.source

    page.execute_script("window.fetch = window.fetchForSaveRetry")
    click_on "Retry save"

    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 5
    assert_includes presentation.reload.source, "# Latest edit"
  end

  def assert_timeline_geometry
    geometry = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const nodes = [...document.querySelectorAll('.lineage-node')];
        const boxes = nodes.map(n => n.getBoundingClientRect());
        const overlaps = [];
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b, j) => {
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
            overlaps.push([nodes[i].dataset.lineageGraphId, nodes[i+j+1].dataset.lineageGraphId]);
        }));
        const edges = [...document.querySelectorAll('.lineage-edge')].map(edge => {
          const parent = document.querySelector('[data-lineage-graph-id="' + edge.dataset.lineageEdgeFrom + '"]').getBoundingClientRect();
          const child = document.querySelector('[data-lineage-graph-id="' + edge.dataset.lineageEdgeTo + '"]').getBoundingClientRect();
          const point = distance => {
            const p = edge.getPointAtLength(distance);
            return new DOMPoint(p.x, p.y).matrixTransform(edge.getScreenCTM());
          };
          const start = point(0), end = point(edge.getTotalLength());
          return { startError: Math.hypot(start.x-parent.right, start.y-(parent.top+parent.height/2)),
            endError: Math.hypot(end.x-child.left, end.y-(child.top+child.height/2)),
            forward: child.left > parent.right,
            marker: !!document.querySelector(edge.getAttribute('marker-end').slice(4,-1)) };
        });
        return { overlaps, edges, slides: nodes.map((n,i) => {
          const s = n.querySelector('.slide').getBoundingClientRect(), b = boxes[i];
          return { ratio: b.width/b.height, left: s.left-b.left, top: s.top-b.top,
            width: s.width-b.width, height: s.height-b.height };
        }) };
      })()
    JAVASCRIPT
    assert_empty geometry["overlaps"], "Slide cards overlap in the browser"
    geometry["slides"].each do |slide|
      assert_in_delta 16.0 / 9, slide["ratio"], 0.01
      %w[left top width height].each { |dimension| assert_in_delta 0, slide[dimension], 1 }
    end
    geometry["edges"].each do |edge|
      assert_operator edge["startError"], :<, 1, "Edge misses the visible parent boundary"
      assert_operator edge["endError"], :<, 1, "Edge misses the visible child boundary"
      assert edge["forward"], "Child must appear to the right of its parent"
      assert edge["marker"]
    end
  end

  test "library controls stay usable on narrow screens and search supports keyboard navigation" do
    Presentation.delete_all
    Presentations::LineageSampleData.load!
    visit presentations_path
    assert_selector ".lineage-node", count: 15

    [1400, 780, 390].each do |width|
      page.driver.browser.manage.window.resize_to(width, 1000)
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

  test "presentation list styling applies inside the presentation surface" do
    presentation = Presentation.create!(title: "Scoped Deck", source: "# Scoped\n\n- One\n- Two")

    visit presentation_path(presentation)
    assert_selector ".presentation-surface"
    assert_equal "disc",
      page.evaluate_script("getComputedStyle(document.querySelector('.presentation-surface ul')).listStyleType")
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
    find("summary.editor-reveal-metadata", text: "Appearance").click
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

  test "Present reveals cumulative events with buttons and reverses them before changing slides" do
    source = "# One\n\n:::step{01}\nFirst reveal\n\n:::step{2}\nSecond reveal\n\n---\n# Two"
    presentation = Presentation.create!(title: "Cumulative Present", source: source)

    visit present_presentation_path(presentation)
    assert_equal "hidden", reveal_visibility("First reveal")
    assert_equal "hidden", reveal_visibility("Second reveal")

    click_button "Next"
    assert_equal "visible", reveal_visibility("First reveal")
    assert_equal "hidden", reveal_visibility("Second reveal")

    click_button "Next"
    assert_equal "visible", reveal_visibility("Second reveal")
    click_button "Next"
    assert_selector ".presentation-slide-frame.is-active-presentation-slide", text: "Two"

    click_button "Previous"
    assert_selector ".presentation-slide-frame.is-active-presentation-slide", text: "One"
    assert_equal "visible", reveal_visibility("First reveal")
    assert_equal "visible", reveal_visibility("Second reveal")

    click_button "Previous"
    assert_equal "visible", reveal_visibility("First reveal")
    assert_equal "hidden", reveal_visibility("Second reveal")
  end

  test "reveals keep one, two, and three column block geometry fixed" do
    source = <<~MARKDOWN
      # One column

      Unmarked before

      :::step{1}
      ## Stable heading

      :::step{2}
      Stepped body

      ---
      # Two columns

      ## Left
      :::step{05}
      Left reveal

      ## Right
      :::step{5}
      Right reveal

      ---
      # Three columns

      ## First
      :::step{2}
      First reveal

      ## Second
      :::step{1}
      Second reveal

      ## Third
      :::step{2}
      Third reveal
    MARKDOWN
    presentation = Presentation.create!(title: "Reveal geometry", source: source)
    visit present_presentation_path(presentation)

    assert_equal "slide-body", find(".presentation-stage .slide-frame.is-active-presentation-slide .slide")[:class].split.last
    initial = reveal_slide_block_boxes
    send_keys :arrow_right
    assert_equal initial, reveal_slide_block_boxes, "revealing the stepped heading moved slide content"
    send_keys :arrow_right
    assert_equal initial, reveal_slide_block_boxes, "revealing the later group moved slide content"

    send_keys :arrow_right
    assert_equal "slide-two-column", find(".presentation-stage .slide-frame.is-active-presentation-slide .slide")[:class].split.last
    initial = reveal_slide_block_boxes
    send_keys :arrow_right
    assert_equal initial, reveal_slide_block_boxes, "revealing both numbered column groups moved slide content"

    send_keys :arrow_right
    assert_equal "slide-three-column", find(".presentation-stage .slide-frame.is-active-presentation-slide .slide")[:class].split.last
    initial = reveal_slide_block_boxes
    send_keys :arrow_right
    assert_equal initial, reveal_slide_block_boxes, "revealing two groups in three columns moved slide content"
  end

  def reveal_visibility(text)
    page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const text = #{JSON.generate(text)};
        const block = [...document.querySelectorAll(".presentation-stage .slide-block[data-elef-reveal-event]")]
          .find((node) => node.textContent.includes(text));
        return block ? getComputedStyle(block).visibility : null;
      })()
    JAVASCRIPT
  end

  def reveal_slide_block_boxes
    page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".presentation-stage .slide-frame.is-active-presentation-slide .slide-block")].map((block) => {
        const rect = block.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100);
      })
    JAVASCRIPT
  end

  test "presentation keyboard shortcuts do not hijack toolbar activation" do
    presentation = Presentation.create!(title: "Keyboard exit", source: "# One")

    visit present_presentation_path(presentation)
    find("a", text: "Exit").send_keys(:enter)

    assert_current_path presentation_path(presentation)
  end

  test "source mode inserts a Mermaid sequence starter and continues with existing participants" do
    presentation = Presentation.create!(title: "Mermaid sequence", source: "# Existing slide")

    visit edit_presentation_path(presentation)
    click_on "Source"
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    editor.send_keys(:enter, "/diagram")

    assert_selector ".mermaid-assist-option", text: "Sequence diagram", wait: 5
    find(".mermaid-assist-option", text: "Sequence diagram").click
    source = find_field("Markdown source")
    assert_includes source.value, "sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Message"
    assert_equal "Message", page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        return editor.value.slice(editor.selectionStart, editor.selectionEnd);
      })()
    JAVASCRIPT

    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      const participant = editor.value.indexOf('Alice->>Bob:') + 'Alice->>'.length;
      editor.setSelectionRange(participant, participant + 3);
      editor.focus();
    JAVASCRIPT
    editor.send_keys("Bo")
    assert_selector ".mermaid-assist-option", text: "Bob", wait: 5
    editor.send_keys(:enter)
    assert_includes source.value, "Alice->>Bob: Message"
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      const message = editor.value.indexOf('Message');
      editor.setSelectionRange(message, message + 'Message'.length);
      editor.focus();
    JAVASCRIPT

    editor.send_keys("Request", :enter)
    assert_includes source.value, "Alice->>Bob: Request\n    Bob->>Alice: Message"
    click_on "Save presentation"
    assert_selector ".flash.notice", text: "Presentation saved.", wait: 10
    assert_equal source.value, presentation.reload.source
  end

  test "inserts a fuzzy snippet and moves through its placeholder" do
    Snippet.create!(name: "Block equation", trigger: "beq", description: "A block LaTeX equation", category: "LaTeX", body: "$$\n${1:equation}\n$$")
    presentation = Presentation.create!(title: "Snippet deck", source: "# Math\n\n/")

    visit edit_presentation_path(presentation)
    click_on "Source"
    source = find_field("Markdown source")
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector(".source-field").editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    editor.send_keys("beq")
    assert_selector ".snippet-palette", visible: true
    assert_text "/beq"
    assert_selector ".snippet-option[aria-selected='true']"
    assert_equal "true", page.evaluate_script("document.querySelector('.cm-editor').getAttribute('aria-expanded')")
    palette_position = page.evaluate_script("(() => { const element = document.querySelector('[data-controller~=editor]'); const editor = element.editorController; const caret = editor.view.coordsAtPos(editor.selectionStart); const palette = document.querySelector('[data-snippet-palette-target=palette]').getBoundingClientRect(); return { belowCaret: Math.abs(palette.top - caret.bottom - 4) < 2, aboveCaret: Math.abs(palette.bottom - caret.top + 4) < 2, paletteBottom: palette.bottom, viewportBottom: window.innerHeight }; })()")
    assert palette_position["belowCaret"] || palette_position["aboveCaret"], "The snippet popup should stay next to the caret"
    assert_operator palette_position["paletteBottom"], :<, palette_position["viewportBottom"]

    editor.send_keys(:enter)
    assert_equal "# Math\n\n$$\nequation\n$$", source.value
    assert_equal "equation", page.evaluate_script("(() => { const e = document.querySelector('[data-snippet-palette-target=editor]'); return e.value.slice(e.selectionStart, e.selectionEnd) })()")
  end

  test "uses the math palette inside math and keeps document commands in their namespace" do
    presentation = Presentation.create!(title: "Math authoring namespaces", source: "# Math")

    visit edit_presentation_path(presentation)
    click_on "Source"
    editor = find(".cm-content")
    editor.send_keys("\n$@a")

    assert_selector ".math-shortcut-option.is-selected", text: /Alpha/
    assert_no_selector "[data-snippet-palette-target='palette'] [role='option']"

    editor.send_keys(:enter)
    source = find_field("Markdown source").value
    assert_includes source, "$\\alpha$"
  end

  test "keeps multiple snippet placeholders aligned while tabbing" do
    Snippet.create!(name: "Two fields", trigger: "twice", description: "Two tab stops", category: "Markdown", body: "A ${1:first} B ${2:second}")
    presentation = Presentation.create!(title: "Multiple stops", source: "# Snippets\n\n/")

    visit edit_presentation_path(presentation)
    click_on "Source"
    source = find_field("Markdown source")
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector(".source-field").editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    editor.send_keys("twice")
    editor.send_keys(:enter)

    selected_text = "(() => { const e = document.querySelector('[data-snippet-palette-target=editor]'); return e.value.slice(e.selectionStart, e.selectionEnd) })()"
    assert_equal "first", page.evaluate_script(selected_text)
    find(".cm-content").send_keys(:tab)
    assert_equal "second", page.evaluate_script(selected_text)
  end

  test "marks every pending snippet tab stop and walks the active mark with Tab" do
    document = Document.create!(title: "Tab stop marks", source: "# Tab stop marks")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n/table")
    assert_selector ".snippet-palette .snippet-option", text: /Table/, wait: 5
    editor.send_keys(:enter)

    assert_selector ".cm-snippet-stop", count: 4, wait: 5
    assert_selector ".cm-snippet-stop-active", count: 1
    assert_equal ["Column 1", "Column 2", "Value 1", "Value 2"], snippet_stop_marks
    assert_equal "Column 1", active_snippet_stop

    find(".cm-content").send_keys(:tab)
    assert_equal ["Column 2", "Value 1", "Value 2"], snippet_stop_marks
    assert_equal "Column 2", active_snippet_stop

    find(".cm-content").send_keys(:tab)
    assert_equal "Value 1", active_snippet_stop
    find(".cm-content").send_keys(:tab)
    assert_equal "Value 2", active_snippet_stop

    find(".cm-content").send_keys(:tab)
    assert_no_selector ".cm-snippet-stop"
    assert_equal "# Tab stop marks\n| Column 1 | Column 2 |\n| --- | --- |\n| Value 1 | Value 2 |",
      find_field("Markdown source").value
  end

  test "escape clears the snippet tab stop marks and leaves Tab alone" do
    document = Document.create!(title: "Escape tab stops", source: "# Escape tab stops")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n/table")
    assert_selector ".snippet-palette .snippet-option", text: /Table/, wait: 5
    editor.send_keys(:enter)
    assert_selector ".cm-snippet-stop", count: 4, wait: 5

    find(".cm-content").send_keys(:escape)
    assert_no_selector ".cm-snippet-stop"

    selection = page.evaluate_script(editor_selection)
    source = find_field("Markdown source").value
    find(".cm-content").send_keys(:tab)

    assert_equal selection, page.evaluate_script(editor_selection)
    assert_equal source, find_field("Markdown source").value
    assert_no_selector ".cm-snippet-stop"
  end

  test "keeps the remaining snippet tab stop marks aligned while typing" do
    document = Document.create!(title: "Typing tab stops", source: "# Typing tab stops")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n/table")
    assert_selector ".snippet-palette .snippet-option", text: /Table/, wait: 5
    editor.send_keys(:enter)
    assert_selector ".cm-snippet-stop", count: 4, wait: 5

    find(".cm-content").send_keys("Header")
    assert_equal ["Header", "Column 2", "Value 1", "Value 2"], snippet_stop_marks
    assert_equal "Header", active_snippet_stop

    find(".cm-content").send_keys(:tab)
    assert_equal ["Column 2", "Value 1", "Value 2"], snippet_stop_marks
    assert_equal "Column 2", active_snippet_stop
    assert_includes find_field("Markdown source").value, "| Header | Column 2 |"
  end

  test "marks math shortcut tab stops and clears them on Escape" do
    document = Document.create!(title: "Fraction tab stops", source: "# Fraction tab stops")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n$x = @frac")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Fraction/, wait: 5
    editor.send_keys(:enter)

    assert_selector ".cm-snippet-stop-empty", count: 2, wait: 5
    assert_selector ".cm-snippet-stop-active", count: 1
    stop_positions = snippet_stop_positions
    assert_equal 2, stop_positions.length
    assert_equal stop_positions.first, active_snippet_stop_position

    find(".cm-content").send_keys("n")
    assert_selector ".cm-snippet-stop", count: 2
    assert_equal "n", page.evaluate_script('document.querySelector(".cm-snippet-stop-active")?.textContent')
    stop_positions = snippet_stop_positions
    find(".cm-content").send_keys(:tab)
    assert_equal stop_positions.last, active_snippet_stop_position

    find(".cm-content").send_keys(:escape)
    assert_no_selector ".cm-snippet-stop"
    selection = page.evaluate_script(editor_selection)
    source = find_field("Markdown source").value
    find(".cm-content").send_keys(:tab)
    assert_equal selection, page.evaluate_script(editor_selection)
    assert_equal source, find_field("Markdown source").value
    assert_no_selector ".cm-snippet-stop"
  end

  test "marks math shortcut tab stops across multiple lines" do
    document = Document.create!(title: "Matrix tab stops", source: "# Matrix tab stops")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n$y = @matrix")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Matrix/, wait: 5
    editor.send_keys(:enter)

    assert_selector ".cm-snippet-stop", count: 4, wait: 5
    stop_positions = snippet_stop_positions
    editor_lines = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector(".source-field").editorController;
        return #{stop_positions.to_json}.map((position) => editor.view.state.doc.lineAt(position).number);
      })()
    JAVASCRIPT
    assert_operator editor_lines.uniq.length, :>, 1
    assert_equal stop_positions.first, active_snippet_stop_position

    find(".cm-content").send_keys(:tab)
    assert_equal stop_positions[1], active_snippet_stop_position
    find(".cm-content").send_keys(:tab)
    assert_equal stop_positions[2], active_snippet_stop_position
  end

  test "positions the palette when only the slash trigger is typed" do
    Snippet.create!(name: "Equation", trigger: "beq", category: "LaTeX", body: "$$\n${1:equation}\n$$")
    visit new_presentation_path
    click_on "Source"
    source = find_field("Markdown source")
    source.fill_in with: "# Math\n\n"
    find(".cm-content").send_keys("/")
    assert_selector ".snippet-option", text: "/beq"
    bounds = page.evaluate_script(<<~JS)
      (() => {
        const element = document.querySelector('[data-controller~="editor"]');
        const editor = element.editorController;
        const palette = document.querySelector('.snippet-palette');
        const caret = editor.view.coordsAtPos(editor.selectionStart), p = palette.getBoundingClientRect();
        return { positioned: palette.style.top !== '', belowCaret: Math.abs(p.top - caret.bottom - 4) < 2, aboveCaret: Math.abs(p.bottom - caret.top + 4) < 2, bottom: p.bottom, viewportBottom: window.innerHeight };
      })()
    JS
    assert bounds["positioned"], "The slash popup must receive caret coordinates before a query is typed"
    assert bounds["belowCaret"] || bounds["aboveCaret"], "The snippet popup should stay next to the caret"
    assert_operator bounds["bottom"], :<, bounds["viewportBottom"]
  end

  test "renders untrusted snippet metadata as text" do
    Snippet.create!(name: '<img src=x onerror="alert(1)">', trigger: "unsafe", description: "Untrusted", category: "Markdown", body: "text")
    presentation = Presentation.create!(title: "Safe snippets", source: "# Safe\n\n/")

    visit edit_presentation_path(presentation)
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector(".source-field").editorController;
      editor.setSelectionRange(editor.value.length);
      editor.focus();
    JAVASCRIPT
    find(".cm-content").send_keys("unsafe")

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

  test "new presentation uploads and renders images in Markdown and visual editor" do
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

  ensure
    image_one_file&.close!
    image_two_file&.close!
  end

  test "changes alignment immediately after visual edits and reflects it visually in the slide block" do
    presentation = Presentation.create!(title: "Visual edit alignment", source: "# Slide\n\nInitial block")
    visit edit_presentation_path(presentation)
    wait_for_fresh_projection

    block = find(".slide-block", text: "Initial block")
    block_id = block["data-editor-block-id"]
    block.click
    block.send_keys(" with extra text")

    alignment = find("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='1']")
    alignment.select("Center Center")

    assert_includes find(".slide-block[data-editor-block-id='#{block_id}']")["class"], "position-center"
    assert_field "Markdown source", with: /:::align\{center center\}\n\nInitial.*block/, wait: 5

    alignment.select("Bottom Right")
    assert_includes find(".slide-block[data-editor-block-id='#{block_id}']")["class"], "position-right"
    assert_field "Markdown source", with: /:::align\{bottom right\}\n\nInitial.*block/, wait: 5

    alignment.select("Left")
    assert_includes find(".slide-block[data-editor-block-id='#{block_id}']")["class"], "position-left"
    assert_field "Markdown source", with: /:::align\{left\}\n\nInitial.*block/, wait: 5
  end
end
