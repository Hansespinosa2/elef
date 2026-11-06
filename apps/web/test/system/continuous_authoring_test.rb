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
    assert_no_selector ".continuous-document .cm-gutters", visible: :all
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

  test "Enter splits a paragraph and Backspace joins it in one uninterrupted flow" do
    source = "# Editing\n\nAlpha beta"
    document = Document.create!(title: "Editing", source: source)
    visit edit_document_path(document, editor_surface: "continuous")
    find(".continuous-document .cm-line", text: "Alpha beta").click
    page.driver.browser.action.send_keys(:end, :enter, "Next").perform
    assert_field "Markdown source", with: "#{source}\n\nNext"
    assert_selector ".continuous-document .cm-line", exact_text: "Next"
    page.driver.browser.action.send_keys(:home, :backspace).perform
    assert_field "Markdown source", with: "#{source}Next"
    assert_equal source.length, page.evaluate_script("document.querySelector('.source-field').editorController.selectionHead")
  end

  test "Enter continues and exits a visual list" do
    source = "# Editing\n\n- First"
    document = Document.create!(title: "Editing", source: source)
    visit edit_document_path(document, editor_surface: "continuous")
    find(".continuous-document .cm-line", text: "First").click
    page.driver.browser.action.send_keys(:end, :enter, "Second", :enter, :enter, "After").perform
    assert_field "Markdown source", with: "#{source}\n- Second\n\nAfter"
    assert_selector ".continuous-document .cm-line", exact_text: "After"
  end

  test "Enter inside fenced code keeps a single source line break" do
    source = "# Editing\n\n```tex\nalpha\n```"
    document = Document.create!(title: "Editing", source: source)
    visit edit_document_path(document, editor_surface: "continuous")
    find(".continuous-document .cm-line", text: "alpha").click
    page.driver.browser.action.send_keys(:end, :enter, "beta").perform
    assert_field "Markdown source", with: source.sub("alpha", "alpha\nbeta")
  end

  test "Vim normal Enter and vertical aliases navigate the same source lines in both modes" do
    source = "# Editing\n\nalpha\nbeta\n\ngamma\n"
    %w[source visual].each do |mode|
      document = Document.create!(title: "Editing #{mode}", source: source)
      visit edit_document_path(document)
      page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
      page.refresh
      assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
      mode == "visual" ? mount_continuous_surface : click_on("Source")
      find(".source-field .cm-content").click
      page.driver.browser.action.send_keys("gg2j0").perform
      current_line = -> { page.evaluate_script("(() => { const e = document.querySelector('.source-field').editorController; return e.view.state.doc.lineAt(e.selectionHead).text; })()") }
      assert_equal "alpha", current_line.call, "#{mode}: initial motion"
      page.driver.browser.action.send_keys(:enter).perform
      assert_equal "beta", current_line.call, "#{mode}: Enter motion"
      page.driver.browser.action.send_keys("x").perform
      assert_field "Markdown source", with: source.sub("beta", "eta"), wait: 5
      page.driver.browser.action.send_keys("gg2j0", :down).perform
      assert_equal "eta", current_line.call, "#{mode}: down arrow"
      page.driver.browser.action.send_keys(:up).perform
      assert_equal "alpha", current_line.call, "#{mode}: up arrow"
      page.driver.browser.action.key_down(:control).send_keys("n").key_up(:control).perform
      assert_equal "eta", current_line.call, "#{mode}: Ctrl-N"
      page.driver.browser.action.key_down(:control).send_keys("p").key_up(:control).perform
      assert_equal "alpha", current_line.call, "#{mode}: Ctrl-P"
    end
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

  test "Vim undo restores a deleted and put line in source and continuous visual" do
    ["\n", "\r\n", "\r"].each_with_index do |separator, index|
      source = "# History\n\nalpha beta gamma\n\nEquation $x^2$.\n".gsub("\n", separator)
      %w[source visual].each do |mode|
        document = Document.create!(title: "Line history #{mode} #{index}", source: source)
        visit edit_document_path(document)
        page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
        page.refresh
        assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
        mode == "visual" ? mount_continuous_surface : click_on("Source")
        find(".source-field .cm-content").click
        read_source = -> { page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue") }
        page.driver.browser.action.send_keys("gg2jddp").perform
        assert_equal source.sub("alpha beta gamma#{separator}#{separator}", "#{separator}alpha beta gamma#{separator}"), read_source.call, "#{mode}: #{separator.inspect} paste"
        page.driver.browser.action.send_keys("uuG").perform
        assert_equal source, read_source.call, "#{mode}: #{separator.inspect} undo"
      end
    end
  end

  test "Vim operators, text objects, macros, and search agree in source and continuous visual" do
    source = "# Heading\n\nalpha beta gamma\n\ndelta epsilon zeta\n\nEquation $x^2$.\n"
    cases = {
      "counted delete" => { keys: ["2dw"], expected: source.sub("alpha beta ", "") },
      "inner word change" => { keys: ["wciwBETA", :escape], expected: source.sub("beta", "BETA") },
      "visual delete" => { keys: ["v2wd"], expected: source.sub("alpha beta g", "") },
      "macro" => { keys: ["qadwq@a"], expected: source.sub("alpha beta ", "") },
      "linewise delete and paste" => { keys: ["ddp"], expected: source.sub("alpha beta gamma\n\n", "\nalpha beta gamma\n") },
      "replace inside math" => { keys: ["Gk0fxry"], expected: source.sub("$x^2$", "$y^2$") },
      "whole document selection" => { keys: ["ggVGd"], expected: "" },
      "search" => { keys: ["/epsilon", :enter], expected: source }
    }
    results = {}
    %w[source visual].each do |mode|
      document = Document.create!(title: "Vim parity #{mode}", source: source)
      visit edit_document_path(document)
      page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
      page.refresh
      assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
      mount_continuous_surface
      click_on "Source" if mode == "source"
      results[mode] = {}
      cases.each do |name, scenario|
        page.execute_script(<<~JAVASCRIPT, source)
          const editor = document.querySelector('.source-field').editorController;
          editor.loadDocument(arguments[0]);
          editor.setVimEnabled(true);
          editor.setSelectionRange(arguments[0].indexOf('alpha'));
          editor.view.focus();
        JAVASCRIPT
        page.driver.browser.action.send_keys(*scenario.fetch(:keys)).perform
        page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
        results[mode][name] = page.evaluate_script(<<~JAVASCRIPT)
          (() => {
            const editor = document.querySelector('.source-field').editorController;
            return { source: editor.sourceValue, head: editor.selectionHead, mode: editor.vimMode };
          })()
        JAVASCRIPT
        assert_equal scenario.fetch(:expected), results[mode][name].fetch("source"), "#{mode}: #{name}"
      end
    end
    cases.each_key { |name| assert_equal results.fetch("source").fetch(name), results.fetch("visual").fetch(name), name }
    assert_equal source.index("epsilon"), results.fetch("visual").fetch("search").fetch("head")
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

  test "entering an equation reveals TeX subscripts without Markdown formatting" do
    source = "# Math\n\nEquation $a_{b_c}$.\n\nAfter.\n"
    document = Document.create!(title: "Math", source: source)
    visit edit_document_path(document, editor_surface: "continuous")
    find(".continuous-document .cm-live-widget-math math", wait: 10).click
    assert_selector ".continuous-document .cm-live-active-syntax", text: "$a_{b_c}$"
    assert_no_selector ".continuous-document .cm-live-emphasis"
    assert_equal source, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
  end

  test "creating an equation leaves later paragraphs and display math in place" do
    source = "# Math\n\nStart.\n\nLater $$x^2$$.\n\nAfter.\n"
    document = Document.create!(title: "Math", source: source)
    visit edit_document_path(document, editor_surface: "continuous")
    assert_selector ".continuous-document .cm-live-widget-math-display math", wait: 10
    after_top = -> { page.evaluate_script("[...document.querySelectorAll('.continuous-document .cm-line')].find(line => line.textContent.trim() === 'After.').getBoundingClientRect().top") }
    before = after_top.call
    find(".continuous-document .cm-line", text: "Start.").click
    page.driver.browser.action.send_keys(:end, "$").perform
    assert_field "Markdown source", with: source.sub("Start.", "Start.$$")
    assert_selector ".continuous-document .cm-live-widget-math-display math", count: 1
    assert_in_delta before, after_top.call, 1
    page.driver.browser.action.send_keys('\\sqrt{a_{i}}$').perform
    expected = source.sub("Start.", 'Start.$\\sqrt{a_{i}}$')
    assert_field "Markdown source", with: expected
    find(".continuous-document .cm-line", text: "After.").click
    assert_selector ".continuous-document .cm-live-widget-math math", count: 1, wait: 10
    assert_selector ".continuous-document .cm-live-widget-math-display math", count: 1
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

  test "a cancelled continuous mount leaves no partial surface or commands" do
    document = Document.create!(title: "Cancelled authoring", source: SOURCE)
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    result = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      import('@elef/client/continuous-editor').then(async ({ mountContinuousAuthoring }) => {
        const abort = new AbortController();
        abort.abort();
        try {
          await mountContinuousAuthoring(document.querySelector('.source-field').editorController, { signal: abort.signal });
          done('mounted');
        } catch (error) { done(error.name); }
      }).catch(error => done(String(error)));
    JAVASCRIPT
    assert_equal "AbortError", result
    assert_no_selector ".continuous-document, .continuous-command-hint, [data-continuous-commands]", visible: :all
    assert_nil page.evaluate_script("document.querySelector('.visual-editor-form').dataset.editorSurface")
    assert_field "Markdown source", with: SOURCE
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
    assert_no_selector ".app-header .app-navigation", visible: true
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

  test "opening commands retains focus after a WebKit style activation" do
    document = Document.create!(title: "Focused commands", source: SOURCE)
    visit edit_document_path(document, editor_surface: "continuous")
    assert_selector ".continuous-command-hint"
    # Some native activations focus the trigger again after its click handler.
    page.execute_script(<<~JAVASCRIPT)
      const trigger = document.querySelector('.continuous-command-hint');
      document.querySelector('.source-field').editorController.view.focus();
      trigger.click();
      trigger.focus();
    JAVASCRIPT
    assert_selector '[data-continuous-commands] [role="combobox"]', focused: true
    page.driver.browser.action.send_keys("Switch to source", :enter).perform
    assert_selector 'form[data-editor-mode="source"]'
  end

  test "input events expose current source while frontmatter is edited" do
    source = "---\ntheme: light\n---\n# Notes\n\nBody"
    document = Document.create!(title: "Source synchronization", source: source)
    visit edit_document_path(document, editor_surface: "continuous")
    assert_selector ".continuous-document"
    result = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        const snapshots = [];
        editor.inputTarget.addEventListener('input', () => snapshots.push({
          proxy: editor.inputTarget.value, source: editor.value, frontmatter: editor.frontmatterRange
        }));
        editor.replaceRange('!', editor.value.length);
        editor.replaceRange('x', 0, 1);
        return snapshots;
      })()
    JAVASCRIPT
    assert_equal ["#{source}!", "x#{source[1..]}!"], result.map { |snapshot| snapshot.fetch("proxy") }
    assert_equal result.map { |snapshot| snapshot.fetch("proxy") }, result.map { |snapshot| snapshot.fetch("source") }
    assert result.first.fetch("frontmatter")
    assert_nil result.last.fetch("frontmatter")
  end

  test "the input proxy normalizes mixed line endings without changing saved source" do
    document = Document.create!(title: "Line endings", source: "# Notes\n")
    visit edit_document_path(document, editor_surface: "continuous")
    assert_selector ".continuous-document"
    source = "# Notes\r\n\r\nBody\rcontinued"
    result = page.evaluate_script(<<~JAVASCRIPT, source)
      ((source) => {
        const editor = document.querySelector('.source-field').editorController;
        editor.loadDocument(source);
        const snapshots = [];
        editor.inputTarget.addEventListener('input', () => snapshots.push(editor.inputTarget.value));
        editor.replaceRange('!', editor.value.length);
        return { source: editor.sourceValue, proxy: editor.inputTarget.value, snapshots };
      })(arguments[0])
    JAVASCRIPT
    assert_equal "#{source}!", result.fetch("source")
    assert_equal "# Notes\n\nBody\ncontinued!", result.fetch("proxy")
    assert_equal [result.fetch("proxy")], result.fetch("snapshots")
    echoed = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        editor.replaceServerSource(editor.sourceValue);
        return editor.sourceValue;
      })()
    JAVASCRIPT
    assert_equal "#{source}!", echoed
    page.execute_script("document.querySelector('form.visual-editor-form').requestSubmit()")
    assert_text "Document saved."
    assert_equal "#{source}!", document.reload.source
    replacement = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        editor.inputTarget.value = '# External\\n\\nChanged';
        editor.inputTarget.dispatchEvent(new Event('input', { bubbles: true }));
        return editor.sourceValue;
      })()
    JAVASCRIPT
    assert_equal "# External\r\n\r\nChanged", replacement
  end

  test "CRLF directives do not hide the following document text" do
    source = "# Notes\r\n\r\n:::align{center}\r\nVisible next\r\n:::\r\n"
    document = Document.create!(title: "CRLF directives", source: source)
    visit edit_document_path(document, editor_surface: "continuous")
    find(".continuous-document .cm-line", text: "Notes").click
    assert_selector ".continuous-document .cm-line", exact_text: "Visible next"
    assert_equal source, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
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

  test "math-only table cells retain their columns in spaced and compact Markdown" do
    source = "# Equations\n\n| Label | Formula |\n| --- | --- |\n| $N$ | $x^2$ |\n|$a$|$b$|\n"
    document = Document.create!(title: "Equation table", source: source)
    visit edit_document_path(document, editor_surface: "continuous")
    assert_selector ".continuous-document .cm-continuous-table-row", count: 3
    assert_selector ".continuous-document .cm-continuous-cell math", count: 4, wait: 5
    providers = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      import('@elef/client/editor').then(({ continuousPlainTableEdit }) => {
        const editor = document.querySelector('.source-field').editorController;
        done(editor.view.state.facet(continuousPlainTableEdit).length);
      });
    JAVASCRIPT
    assert_equal 1, providers, "the shipped editor and continuous surface share the same table-edit facet"
    rows = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll('.continuous-document .cm-continuous-table-row')].map(row =>
        [...row.querySelectorAll(':scope > .cm-continuous-cell')].map(cell => {
          const rect = cell.getBoundingClientRect();
          return { left: rect.left, width: rect.width };
        }))
    JAVASCRIPT
    assert_equal [2, 2, 2], rows.map(&:length)
    rows.drop(1).each do |row|
      rows.first.zip(row).each do |header, cell|
        assert_in_delta header["left"], cell["left"], 1
        assert_in_delta header["width"], cell["width"], 1
      end
    end
    assert_equal source, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
  end

  test "display math, nested lists and quotations preserve reader geometry" do
    source = "# Layout\n\nA short introduction.\n\n$$x^2 + y^2$$\n\n- First item.\n  - Nested item.\n\n> A quotation.\n\nAfter the quotation.\n"
    document = Document.create!(title: "Layout", source: source)
    visit document_path(document)
    assert_selector ".document-page .katex-display math", wait: 10
    page.evaluate_async_script("const done = arguments[arguments.length - 1]; document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(done)));")
    reader = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const title = document.querySelector('.document-page h1').getBoundingClientRect();
        const nodes = [document.querySelector('.document-page .katex-display'),
          ...document.querySelectorAll('.document-page li'), document.querySelector('.document-page blockquote'),
          [...document.querySelectorAll('.document-page p')].find(node => node.textContent.trim() === 'After the quotation.')];
        return nodes.map(node => { const r = node.getBoundingClientRect(); return { top: r.top - title.top, height: r.height }; });
      })()
    JAVASCRIPT
    visit edit_document_path(document, editor_surface: "continuous")
    assert_selector ".continuous-document .cm-live-widget-math-display math", wait: 10
    page.evaluate_async_script("const done = arguments[arguments.length - 1]; document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(done)));")
    editor = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const title = document.querySelector('.continuous-document .cm-live-heading-1').getBoundingClientRect();
        const nodes = [document.querySelector('.continuous-document .cm-live-widget-math-display'),
          ...document.querySelectorAll('.continuous-document .cm-live-list-item'), document.querySelector('.continuous-document .cm-live-quote'),
          [...document.querySelectorAll('.continuous-document .cm-line')].find(node => node.textContent.trim() === 'After the quotation.')];
        return nodes.map(node => { const r = node.getBoundingClientRect(); return { top: r.top - title.top, height: r.height }; });
      })()
    JAVASCRIPT
    assert_equal reader.length, editor.length
    reader.zip(editor).each_with_index do |(expected, actual), index|
      assert_in_delta expected["top"], actual["top"], 1, "element #{index}: reader #{reader.inspect}; editor #{editor.inspect}"
    end
    [0, 3, 4].each { |index| assert_in_delta reader[index]["height"], editor[index]["height"], 1 }
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
    assert_selector ".source-field .cm-lineNumbers", visible: :all
    assert_match /mono/i, page.evaluate_script("getComputedStyle(document.querySelector('.source-field .cm-scroller')).fontFamily")
    assert_equal "pre", page.evaluate_script("getComputedStyle(document.querySelector('.source-field .cm-content')).whiteSpace")
    click_on "Visual"
    assert_selector ".continuous-document .cm-line", exact_text: "alpha beta gamma delta"
    assert_no_selector ".continuous-document .cm-gutters", visible: :all
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
