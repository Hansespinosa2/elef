require "application_system_test_case"

# Exercise genuine input without resetting the caret or blurring between
# commands. Source correctness alone misses a stale focused projection.
class ContinuousAuthoringTest < ApplicationSystemTestCase
  SOURCE = "# Authoring\n\nalpha beta gamma\n\nSecond paragraph.\n\nFinal paragraph.\n".freeze

  def mount_continuous_surface
    result = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      import('@elef/client/continuous-editor').then(async ({ mountContinuousDocument }) => {
        await mountContinuousDocument(document.querySelector('.source-field').editorController);
        done('mounted');
      }).catch(error => done(String(error)));
    JAVASCRIPT
    assert_equal "mounted", result
  end

  def mount_focused_authoring
    result = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      import('@elef/client/continuous-editor').then(async ({ mountContinuousAuthoring }) => {
        window.continuousAuthoring = await mountContinuousAuthoring(document.querySelector('.source-field').editorController);
        done('mounted');
      }).catch(error => done(String(error)));
    JAVASCRIPT
    assert_equal "mounted", result
  end

  test "visual Vim changes remain visible throughout an uninterrupted session" do
    document = Document.create!(title: "Authoring", source: SOURCE)
    visit edit_document_path(document)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    assert_selector ".continuous-document", visible: :all
    block = find(".continuous-document .cm-line", text: "alpha beta gamma")
    block.click
    assert_equal "alpha beta gamma", page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        return editor.view.state.doc.lineAt(editor.selectionHead).text;
      })()
    JAVASCRIPT
    block.send_keys("0dw")
    assert_field "Markdown source", with: SOURCE.sub("alpha beta", "beta")
    assert_selector ".continuous-document .cm-line", exact_text: "beta gamma"
    page.driver.browser.action.send_keys("u").perform
    assert_field "Markdown source", with: SOURCE
    assert_selector ".continuous-document .cm-line", exact_text: "alpha beta gamma"
  end

  test "rendered tables keep cell text editable by the document Vim engine" do
    source = "# Tables\n\n| Name | Value |\n| --- | --- |\n| alpha | beta |\n"
    document = Document.create!(title: "Tables", source: source)
    visit edit_document_path(document)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    cell = find(".continuous-document .cm-continuous-cell", text: "alpha")
    cell.click
    page.driver.browser.action.send_keys("0facw", "gamma", :escape).perform
    assert_field "Markdown source", with: source.sub("alpha", "gamma")
    assert_selector ".continuous-document .cm-continuous-cell", exact_text: "gamma"
    assert_selector ".continuous-document .cm-continuous-cell", exact_text: "beta"
    assert_equal 1, page.evaluate_script("document.querySelector('.continuous-document').querySelectorAll('[contenteditable=true]').length")
  end

  test "Vim change and independent insert sessions have the same undo boundaries in both modes" do
    source = "# History\n\nalpha beta gamma\n"
    document = Document.create!(title: "History", source: source)
    %w[source visual].each do |mode|
      visit edit_document_path(document)
      page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
      page.refresh
      assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
      mode == "visual" ? mount_continuous_surface : click_on("Source")
      find(".source-field .cm-content").click
      page.driver.browser.action.send_keys("gg2j0cw", "delta", :escape).perform
      assert_field "Markdown source", with: source.sub("alpha", "delta"), wait: 5
      page.driver.browser.action.send_keys("u").perform
      assert_field "Markdown source", with: source
      page.driver.browser.action.key_down(:control).send_keys("r").key_up(:control).perform
      assert_field "Markdown source", with: source.sub("alpha", "delta")
      page.driver.browser.action.send_keys("A", " one", :escape, "A", " two", :escape, "u").perform
      assert_field "Markdown source", with: source.sub("alpha beta gamma", "delta beta gamma one")
      page.driver.browser.action.send_keys("u").perform
      assert_field "Markdown source", with: source.sub("alpha", "delta")
      page.driver.browser.action.send_keys("u").perform
      assert_field "Markdown source", with: source
    end
  end

  test "continuous authoring accepts math assists without moving focus to the old projection" do
    document = Document.create!(title: "Math assists", source: "# Notes\n\nBody")
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    find(".continuous-document .cm-line", text: "Body").click
    page.driver.browser.action.send_keys(:end, " $@a").perform
    assert_selector ".math-shortcut-palette:not([hidden]) .snippet-option", text: /alpha/i
    page.driver.browser.action.send_keys(:enter, :escape, :end, "$").perform
    assert_field "Markdown source", with: /\\alpha/
    assert page.evaluate_script("document.querySelector('.continuous-document').contains(document.activeElement)")
    assert_equal 1, page.evaluate_script("document.querySelector('.continuous-document').querySelectorAll('[contenteditable=true]').length")
  end

  test "the frozen math notebook keeps paragraph virtualization during sustained typing" do
    source = File.read(Rails.root.join("test/fixtures/performance/elef-visual-100-math.md"))
    document = Document.create!(title: "Mathematical notebook", source: source)
    visit edit_document_path(document, editor_surface: "continuous")
    assert_selector ".continuous-document", wait: 20
    assert_no_selector ".editor-projection .document-page", visible: :all
    metrics = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        return { from: editor.view.viewport.from, to: editor.view.viewport.to, length: editor.view.state.doc.length,
          renderedLines: editor.view.dom.querySelectorAll('.cm-line').length };
      })()
    JAVASCRIPT
    assert_operator metrics["to"] - metrics["from"], :<, metrics["length"] / 2
    assert_operator metrics["renderedLines"], :<, 100
    page.execute_script("window.scrollTo(0, document.documentElement.scrollHeight)")
    page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
    assert_selector ".continuous-document .cm-line", text: /A quick check uses/, wait: 10
    end_viewport = page.evaluate_script("document.querySelector('.source-field').editorController.view.viewport.to")
    assert_operator end_viewport, :>, metrics["length"] * 0.9
    burst = " Authoring mathematics with uninterrupted keyboard input."
    page.driver.browser.action.key_down(:control).send_keys(:end).key_up(:control).send_keys(burst).perform
    assert_equal source + burst, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
    assert page.evaluate_script("document.querySelector('.continuous-document').contains(document.activeElement)")
  end

  test "explicit continuous startup skips the old projection and restores source preview on demand" do
    document = Document.create!(title: "Startup", source: SOURCE)
    visit edit_document_path(document, editor_surface: "continuous")
    assert_selector ".continuous-document .cm-line", text: "alpha beta gamma"
    assert_no_selector ".editor-projection .document-page", visible: :all
    find(".continuous-command-hint").click
    find('[data-continuous-commands] [role="combobox"]').send_keys("Switch to source", :enter)
    assert_selector 'form[data-editor-mode="source"]'
    assert_selector ".editor-projection .document-page", wait: 20
    click_on "Visual"
    assert_selector ".continuous-document .cm-line", text: "alpha beta gamma"
    assert_equal SOURCE, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
  end

  test "continuous startup resolves work images through the existing asset endpoint" do
    source = "# Image\n\n![Chart](images/perf-1.svg)\n"
    document = Document.create!(title: "Image", source: source)
    image = Rails.root.join("test/fixtures/performance/assets/perf-1.svg")
    File.open(image, "rb") { |file| document.assets.attach(io: file, filename: "perf-1.svg", content_type: "image/svg+xml") }
    visit edit_document_path(document, editor_surface: "continuous")
    assert_selector ".continuous-document img.cm-live-image[alt='Chart']", wait: 5 do |image_element|
      image_element.evaluate_script("this.complete && this.naturalWidth > 0")
    end
    assert_equal source, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
  end

  test "continuous appearance follows reader theme and typography changes" do
    source = "---\ntheme: dark\ntypography: technical\n---\n# Appearance\n\nBody text.\n"
    light_source = source.sub("dark", "light").sub("technical", "modern")
    light = Document.create!(title: "Light appearance", source: light_source)
    dark = Document.create!(title: "Dark appearance", source: source)
    reader_style = lambda do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => { const heading = getComputedStyle(document.querySelector('.document-surface h1'));
          const body = getComputedStyle(document.querySelector('.document-surface p'));
          const paper = getComputedStyle(document.querySelector('.document-page'));
          return { font: heading.font, heading: heading.color, body: body.color, background: paper.backgroundImage, backgroundColor: paper.backgroundColor }; })()
      JAVASCRIPT
    end
    visit document_path(light)
    light_style = reader_style.call
    visit document_path(dark)
    dark_style = reader_style.call
    visit edit_document_path(dark, editor_surface: "continuous")
    assert_selector ".continuous-document .cm-live-heading"
    editor_style = lambda do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => { const heading = getComputedStyle(document.querySelector('.continuous-document .cm-live-heading'));
          const body = getComputedStyle([...document.querySelectorAll('.continuous-document .cm-line')].find(line => line.textContent.includes('Body text')));
          const paper = getComputedStyle(document.querySelector('.continuous-document'));
          return { font: heading.font, heading: heading.color, body: body.color, background: paper.backgroundImage, backgroundColor: paper.backgroundColor }; })()
      JAVASCRIPT
    end
    assert_equal dark_style, editor_style.call
    find(".continuous-command-hint").click
    find('[data-continuous-commands] [role="combobox"]').send_keys("Show editor controls", :enter)
    find(".appearance-settings summary").click
    select "Light", from: "Theme"
    select "Modern", from: "Typography"
    assert_equal light_style, editor_style.call
    assert_match(/theme: light.*typography: modern/m, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue"))
  end

  test "document focus exposes shared commands and restores the editor caret" do
    document = Document.create!(title: "Focused", source: SOURCE)
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_focused_authoring
    assert_no_selector ".editor-toolbar", visible: true
    assert_selector ".continuous-command-hint", text: /Ctrl\+K|⌘K/
    find(".continuous-document .cm-line", text: "alpha beta gamma").click
    position = page.evaluate_script("document.querySelector('.source-field').editorController.selectionHead")
    page.driver.browser.action.key_down(:control).send_keys("k").key_up(:control).perform
    assert_selector '.command-palette [role="combobox"]', focused: true
    page.driver.browser.action.send_keys(:escape).perform
    assert_no_selector ".command-palette"
    assert_equal position, page.evaluate_script("document.querySelector('.source-field').editorController.selectionHead")
    assert page.evaluate_script("document.querySelector('.continuous-document').contains(document.activeElement)")

    find(".continuous-command-hint").click
    find('.command-palette [role="combobox"]').send_keys("Show editor controls", :enter)
    assert_selector ".editor-toolbar", visible: true
    find(".continuous-command-hint").click
    find('.command-palette [role="combobox"]').send_keys("Switch to source", :enter)
    assert_selector 'form[data-editor-mode="source"]'
    click_on "Visual"
    assert_selector ".continuous-document"
    assert_selector "#bug-report-recording-disclosure", visible: true
  end

  test "focused commands preserve snippet placeholder selection" do
    document = Document.create!(title: "Focused snippets", source: "# Notes\n\nBody")
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_focused_authoring
    find(".continuous-document .cm-line", text: "Body").click
    page.driver.browser.action.send_keys(:end, " ").perform
    find(".continuous-command-hint").click
    find('[data-continuous-commands] [role="combobox"]').send_keys("Insert snippet or directive", :enter)
    assert_selector ".snippet-palette:not([hidden]) .snippet-option", wait: 5
    page.driver.browser.action.send_keys("table").perform
    assert_selector ".snippet-palette:not([hidden]) .snippet-option", text: "Table"
    page.driver.browser.action.send_keys(:enter).perform
    assert_field "Markdown source", with: /\| Column 1 \| Column 2 \|/
    selection = page.evaluate_script(<<~JAVASCRIPT)
      (() => { const e = document.querySelector('.source-field').editorController;
        return e.value.slice(e.selectionStart, e.selectionEnd); })()
    JAVASCRIPT
    assert_equal "Column 1", selection
    page.driver.browser.action.send_keys("Name").perform
    assert_field "Markdown source", with: /\| Name \| Column 2 \|/
  end

  test "continuous table columns preserve the renderer layout instead of equalizing widths" do
    source = "# Table layout\n\n| Parameter | Value |\n| --- | ---: |\n| A much longer parameter description that should receive more width | 2 |\n"
    document = Document.create!(title: "Table layout", source: source)
    visit document_path(document)
    assert_selector ".document-reader table"
    expected = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const table = document.querySelector('.document-reader table');
        return [...table.querySelectorAll('th')].map(cell => cell.getBoundingClientRect().width / table.getBoundingClientRect().width);
      })()
    JAVASCRIPT
    assert_equal "400", page.evaluate_script("getComputedStyle(document.querySelector('.document-surface h1')).fontWeight")
    expected_alignment = page.evaluate_script("[...document.querySelectorAll('.document-reader table th, .document-reader table td')].map(cell => getComputedStyle(cell).textAlign)")
    reader_style = page.evaluate_script("(() => { const t = document.querySelector('.document-reader table'); const s = getComputedStyle(t.querySelector('th')); return {width:t.getBoundingClientRect().width,font:s.font,padding:s.padding}; })()")
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    find(".continuous-document .cm-content").send_keys([:control, :end])
    actual = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const row = document.querySelector('.cm-continuous-table-header');
        if (!row) throw new Error(document.querySelector('.continuous-document .cm-content').innerHTML);
        return [...row.querySelectorAll('.cm-continuous-cell')].map(cell => cell.getBoundingClientRect().width / row.getBoundingClientRect().width);
      })()
    JAVASCRIPT
    actual_alignment = page.evaluate_script("[...document.querySelectorAll('.continuous-document .cm-continuous-cell')].map(cell => getComputedStyle(cell).textAlign)")
    assert_equal expected_alignment, actual_alignment
    assert_equal expected.length, actual.length
    probe_style = page.evaluate_script("(() => { const t = document.querySelector('.continuous-table-measure table'); const s = getComputedStyle(t.querySelector('th')); return {width:t.getBoundingClientRect().width,font:s.font,padding:s.padding}; })()")
    expected.zip(actual).each { |reader, editor| assert_in_delta reader, editor, 0.005, "reader #{reader_style.inspect}; probe #{probe_style.inspect}" }
  end

  test "source switches and saves preserve the same editor state and visual changes" do
    document = Document.create!(title: "Authoring", source: SOURCE)
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    find(".continuous-document .cm-line", text: "alpha beta gamma").click
    page.driver.browser.action.send_keys(:end, " delta").perform
    expected = SOURCE.sub("alpha beta gamma", "alpha beta gamma delta")
    assert_field "Markdown source", with: expected
    page.execute_script("window.authoringView = document.querySelector('.source-field').editorController.view")
    click_on "Source"
    assert_no_selector ".continuous-document"
    assert_match /mono/i, page.evaluate_script("getComputedStyle(document.querySelector('.source-field .cm-scroller')).fontFamily")
    assert_equal "pre", page.evaluate_script("getComputedStyle(document.querySelector('.source-field .cm-content')).whiteSpace")
    click_on "Visual"
    assert_selector ".continuous-document .cm-line", exact_text: "alpha beta gamma delta"
    assert page.evaluate_script("window.authoringView === document.querySelector('.source-field').editorController.view")
    click_on "Save document"
    assert_text "Document saved."
    assert_equal expected, document.reload.source
    visit edit_document_path(document)
    assert_field "Markdown source", with: expected
  end

  test "continuous prose preserves reader soft breaks, typography, and vertical spacing" do
    source = "# Typography\n\nA short source line\ncontinues in the same paragraph.\n\n## Next section\n\nA final paragraph.\n"
    document = Document.create!(title: "Typography", source: source)
    visit document_path(document)
    expected = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const nodes = [...document.querySelectorAll('.document-surface h1, .document-surface h2, .document-surface p')];
        const top = nodes[0].getBoundingClientRect().top;
        return nodes.map(node => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
          const clone = node.cloneNode(true); clone.querySelectorAll('.cm-live-syntax-marker, .cm-widgetBuffer').forEach(marker => marker.remove());
          return {text:clone.textContent.trim().replace(/\\s+/g,' '), top:rect.top-top, height:rect.height, font:style.font}; });
      })()
    JAVASCRIPT
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    find(".continuous-document .cm-content").send_keys([:control, :end])
    actual = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const nodes = [...document.querySelectorAll('.continuous-document .cm-line')].filter(node => node.textContent.trim());
        const top = nodes[0].getBoundingClientRect().top;
        return nodes.map(node => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
          const clone = node.cloneNode(true); clone.querySelectorAll('.cm-live-syntax-marker, .cm-widgetBuffer').forEach(marker => marker.remove());
          return {text:clone.textContent.trim().replace(/\\s+/g,' '), top:rect.top-top, height:rect.height, font:style.font}; });
      })()
    JAVASCRIPT
    assert_equal expected.length, actual.length, actual.inspect
    expected.zip(actual).each do |reader, editor|
      assert_equal reader["text"], editor["text"]
      assert_equal reader["font"], editor["font"]
      assert_in_delta reader["height"], editor["height"], 1
      assert_in_delta reader["top"], editor["top"], 1
    end
  end

  test "Vim can edit an equation and leave it rendered without a projection refresh" do
    source = "# Math\n\nEquation $x^2$.\n\nAfter.\n"
    document = Document.create!(title: "Math", source: source)
    visit edit_document_path(document)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    page.driver.browser.action.send_keys("ggjjfxryG").perform
    assert_field "Markdown source", with: source.sub("$x^2$", "$y^2$")
    assert_selector ".continuous-document math", text: /y/
    page.driver.browser.action.send_keys("u").perform
    assert_field "Markdown source", with: source
    assert_selector ".continuous-document .cm-line", text: "$x^2$"
    page.driver.browser.action.send_keys("G").perform
    assert_selector ".continuous-document math", text: /x/
  end
end
