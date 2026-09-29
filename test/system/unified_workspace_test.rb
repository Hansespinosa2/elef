require "application_system_test_case"

class UnifiedWorkspaceTest < ApplicationSystemTestCase
  test "Mod+K opens Elef actions without listing work" do
    document = Document.create!(title: "Palette target", source: "# Palette target")

    visit edit_document_path(document)
    page.driver.browser.action.key_down(:control).send_keys("k").key_up(:control).perform
    assert_selector "dialog.command-palette[open]"
    assert_selector "#command-palette-heading", text: "Command palette"
    assert_selector ".command-palette-option", text: "New presentation"
    assert_selector ".command-palette-option", text: "Open settings"
    assert_no_selector ".command-palette-option", text: document.title

    fill_in "Filter commands…", with: "new presentation"
    assert_selector ".command-palette-option", text: "New presentation"
    assert_no_selector ".command-palette-option", text: document.title
    find(".command-palette-option", text: "New presentation").click

    assert_current_path new_presentation_path
  end

  test "creates a snippet from the command palette using only the keyboard" do
    visit root_path
    page.driver.browser.action.key_down(:control).send_keys("k").key_up(:control).perform

    input = find("[data-command-palette-target='input']")
    input.send_keys("new snippet", :enter)

    assert_current_path new_snippet_path
    assert_selector "#snippet_name:focus"
    assert_selector "label[for='snippet_name']", text: "Name"
    assert_selector "label[for='snippet_trigger']", text: "Trigger"
    assert_selector "label[for='snippet_body']", text: "Body"

    keyboard = page.driver.browser.action
    keyboard.send_keys("Meeting outline").send_keys(:tab).send_keys("agenda")
      .send_keys(:tab).send_keys("A reusable meeting outline")
      .send_keys(:tab).send_keys(:tab).send_keys("# Agenda")
      .send_keys(:enter).send_keys(:enter).send_keys("- ${1:topic}")
      .send_keys(:tab).send_keys(:enter).perform

    assert_current_path snippets_path
    assert_selector ".flash", text: "Snippet created."
    assert_selector ".snippet-card", text: "Meeting outline"
    snippet = Snippet.find_by!(trigger: "agenda")
    assert_equal "# Agenda\n\n- ${1:topic}", snippet.body
  end

  test "changes a workspace appearance default from the command palette using only the keyboard" do
    workspace = Workspace.default
    workspace.update_style_defaults(theme: "match", typography: "book")
    visit root_path
    page.driver.browser.action.key_down(:control).send_keys("k").key_up(:control).perform

    input = find("[data-command-palette-target='input']")
    input.send_keys("change workspace appearance", :enter)
    assert_selector "#command-palette-heading", text: "Change workspace appearance"
    assert_selector ".command-palette-hint", text: /Esc back/

    input.send_keys(:enter)
    assert_selector "#command-palette-heading", text: "Change default theme"
    input.send_keys(:arrow_down, :arrow_down, :enter)

    assert_selector "[data-command-palette-target='status']", text: "Workspace default theme set to Dark. Applies to new and unstyled work; work-specific settings take precedence."
    assert_equal "dark", workspace.reload.default_theme
    assert_equal "book", workspace.default_typography
  end

  test "Mod+P searches document and presentation content with work type filters" do
    document = Document.create!(title: "Field archive", source: "# Field archive\n\nA memorable\nphrase from an old survey")
    presentation = Presentation.create!(title: "Survey talk", source: "# Survey talk\n\nA memorable\nphrase from an old survey")
    source = Document.create!(title: "Palette source", source: "# Palette source")

    visit edit_document_path(source)
    page.driver.browser.action.key_down(:control).send_keys("p").key_up(:control).perform
    assert_selector "dialog.command-palette[open]"
    assert_selector "#command-palette-heading", text: "Search presentations and documents"
    assert_selector ".command-palette-filters button[aria-pressed='true']", text: "All work"

    fill_in "Search by title, alias, heading, or content…", with: '"memorable phrase"'
    assert_selector ".command-palette-option", text: document.title, wait: 5
    assert_selector ".command-palette-option", text: presentation.title, wait: 5

    click_on "Documents"
    assert_selector ".command-palette-option", text: document.title, wait: 5
    assert_no_selector ".command-palette-option", text: presentation.title
    find(".command-palette-option", text: document.title).click

    assert_current_path document_path(document)
  end

  test "uses the math shortcut palette for aliases inside math" do
    document = Document.create!(title: "Math palette", source: "# Math palette")
    MathShortcut.create!(name: "Array", aliases: ["array"], prefix: "@", expansion: "\\operatorname{array}")

    visit edit_document_path(document)
    click_on "Source"
    page.execute_script("const editor = document.querySelector('.source-field').editorController; editor.setSelectionRange(editor.value.length, editor.value.length); editor.focus();")
    editor = find(".cm-content")
    editor.send_keys("\n$x.b")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Bold/, wait: 5
    editor.send_keys(:enter)

    editor.send_keys("\n$@a")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Alpha/, wait: 5
    assert_selector ".math-shortcut-option.is-selected", text: /Alpha/
    editor.send_keys(:enter)

    source = find_field("Markdown source").value
    assert_includes source, "$\\mathbf{x}"
    assert_includes source, "\\alpha"
    refute_includes source, "\\operatorname{array}"

    editor.send_keys(" @Q")
    capital_theta = find(".math-shortcut-option", text: /Capital Theta/, wait: 5)
    within(capital_theta) do
      assert_selector ".math-shortcut-trigger", text: "@Q"
      assert_selector ".math-shortcut-expansion", text: "\\Theta"
    end
    editor.send_keys(:enter)

    editor.send_keys(" @q")
    theta = find(".math-shortcut-option", text: /^Theta/, wait: 5)
    within(theta) do
      assert_selector ".math-shortcut-trigger", text: "@q"
      assert_selector ".math-shortcut-expansion", text: "\\theta"
    end
    editor.send_keys(:enter)

    editor.send_keys(" @w")
    omega = find(".math-shortcut-option", text: /^Omega/, wait: 5)
    within(omega) do
      assert_selector ".math-shortcut-trigger", text: "@w"
      assert_selector ".math-shortcut-expansion", text: "\\omega"
    end
    editor.send_keys(:enter)

    source = find_field("Markdown source").value
    assert_includes source, "\\Theta"
    assert_includes source, "\\theta"
    assert_includes source, "\\omega"

    editor.send_keys(" @A")
    assert_no_selector ".math-shortcut-palette:not([hidden])", wait: 1
  end

  test "shows and accepts beta and theta shortcuts after an inline math opener" do
    document = Document.create!(title: "Greek math palette", source: "# Greek math palette")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n$ @b")

    beta = find(".math-shortcut-option", text: /Beta/, wait: 5)
    within(beta) do
      assert_selector ".math-shortcut-trigger", text: "@b"
      assert_selector ".math-shortcut-expansion", text: "\\beta"
    end
    editor.send_keys(:tab)
    assert_includes find_field("Markdown source").value, "$ \\beta"

    editor.send_keys(" @q")
    theta = find(".math-shortcut-option", text: /^Theta/, wait: 5)
    within(theta) do
      assert_selector ".math-shortcut-trigger", text: "@q"
      assert_selector ".math-shortcut-expansion", text: "\\theta"
    end
    editor.send_keys(:tab)
    source = find_field("Markdown source").value
    assert_includes source, "\\beta"
    assert_includes source, "\\theta"

    editor.send_keys(" @=")
    equivalent = find(".math-shortcut-option", text: /Equivalent/, wait: 5)
    within(equivalent) do
      assert_selector ".math-shortcut-trigger", text: "@="
      assert_selector ".math-shortcut-expansion", text: "\\equiv"
    end
    editor.send_keys(:tab)
    assert_includes find_field("Markdown source").value, "\\equiv"
  end

  test "shows compact math shortcut suggestions with their LaTeX expansion" do
    document = Document.create!(title: "Math shortcut previews", source: "# Math shortcut previews")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n$@g")

    gamma = find(".math-shortcut-option", text: /Gamma/, wait: 5)
    within(gamma) do
      assert_selector ".math-shortcut-trigger", text: "@g"
      assert_selector ".math-shortcut-expansion", text: "\\gamma"
      assert_no_selector ".math-shortcut-preview-render"
    end
    assert_operator page.all(".math-shortcut-option").length, :<=, 6
    assert_operator page.evaluate_script("document.querySelector('.math-shortcut-palette').getBoundingClientRect().height"), :<, 300
    assert_equal "rgb(17, 22, 26)", page.evaluate_script("getComputedStyle(document.querySelector('.math-shortcut-palette')).backgroundColor")
    assert_equal "rgb(32, 44, 50)", page.evaluate_script("getComputedStyle(document.querySelector('.math-shortcut-option.is-selected')).backgroundColor")

    editor.send_keys(:enter)
    editor.send_keys(" x.bar")
    bar = find(".math-shortcut-option", text: /Bar/, wait: 5)
    within(bar) do
      assert_selector ".math-shortcut-trigger", text: "x.bar"
      assert_selector ".math-shortcut-expansion", text: "\\bar{x}"
    end

    editor.send_keys(:enter)
    editor.send_keys(" @longright")
    arrow = find(".math-shortcut-option", text: /Long right arrow/, wait: 5)
    within(arrow) do
      assert_selector ".math-shortcut-trigger", text: "@longright"
      assert_selector ".math-shortcut-expansion", text: "\\longrightarrow"
    end
  end

  test "uses dark Aradia surfaces for math shortcut settings" do
    visit math_shortcuts_path

    assert_selector ".math-shortcut-card"
    assert_equal "rgb(24, 33, 38)", page.evaluate_script("getComputedStyle(document.querySelector('.math-shortcut-card')).backgroundColor")

    click_on "New shortcut"
    assert_selector ".math-shortcut-form"
    assert_equal "rgb(24, 33, 38)", page.evaluate_script("getComputedStyle(document.querySelector('.math-shortcut-form')).backgroundColor")
    assert_equal "rgb(17, 22, 26)", page.evaluate_script("getComputedStyle(document.querySelector('.math-shortcut-form input')).backgroundColor")
  end

  test "expands common TeX operators and walks fraction tab stops" do
    document = Document.create!(title: "TeX operators", source: "# TeX operators")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n$@nabla")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Nabla/, wait: 5
    editor.send_keys(:enter)

    editor.send_keys(" @to")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Right arrow/, wait: 5
    editor.send_keys(:enter)
    editor.send_keys(" @inf")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Infimum/, wait: 5
    editor.send_keys(:enter)
    editor.send_keys(" @sum")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Summation/, wait: 5
    editor.send_keys(:enter)

    editor.send_keys(" @frac")
    assert_selector ".math-shortcut-palette .snippet-option", text: /Fraction/, wait: 5
    editor.send_keys(:enter)
    editor.send_keys("u", :tab, "v", :tab)
    editor.send_keys("$")

    source = find_field("Markdown source").value
    assert_includes source, "$\\nabla \\to \\inf \\sum \\frac{u}{v}"
    assert_selector ".document-surface .katex", minimum: 1, wait: 5
    assert_no_selector ".math-error"
  end

  test "inserts structured math entries with ordered placeholder stops" do
    document = Document.create!(title: "Structured math", source: "# Math\n\n$$x$$")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector(".source-field").editorController;
      const opening = editor.value.indexOf("$$x") + 2;
      editor.setSelectionRange(opening);
      editor.focus();
    JAVASCRIPT

    editor.send_keys("@frac")
    assert_selector ".math-shortcut-option", text: /Fraction/, wait: 5
    editor.send_keys(:enter, "n", :tab, "d", :tab, " +@choose")
    assert_selector ".math-shortcut-option", text: /Choose/, wait: 5
    editor.send_keys(:enter, "n", :tab, "k", :tab, " +@cases")
    assert_selector ".math-shortcut-option", text: /Cases/, wait: 5
    editor.send_keys(:enter, "f(x)", :tab, "x>0", :tab, "0", :tab, "otherwise", :tab, " +@equation")
    assert_selector ".math-shortcut-option", text: /Equation/, wait: 5
    editor.send_keys(:enter, "lhs", :tab, "rhs", :tab, " +@gather")
    assert_selector ".math-shortcut-option", text: /Gather/, wait: 5
    editor.send_keys(:enter, "g_1", :tab, "g_2", :tab)

    source = find_field("Markdown source").value
    expected = [
      "\\frac{n}{d}",
      "\\binom{n}{k}",
      "\\begin{cases}",
      "f(x) & x>0",
      "0 & otherwise",
      "\\begin{aligned}",
      "lhs &= rhs",
      "\\begin{gathered}",
      "g_1 \\\\",
      "g_2"
    ]
    positions = expected.map { |fragment| source.index(fragment) }
    assert positions.all?, "missing structured output in #{source.inspect}"
    assert_equal positions.sort, positions, "math placeholders or commands were reordered"
    %w[@frac @choose @cases @equation @gather].each { |command| refute_includes source, command }
  end

  test "uses the selected math transform without duplicating its base" do
    document = Document.create!(title: "Selected math transform", source: "# Math")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n$x.bo")
    find(".math-shortcut-palette .snippet-option", text: /Bold/).click
    editor.send_keys(:enter)

    source = find_field("Markdown source").value
    assert_includes source, "$\\mathbf{x}"
    refute_includes source, "$x\\mathbf{x}"
  end

  test "meets the synchronous math-assist latency gate across 1000 CodeMirror edits" do
    document = Document.create!(title: "Math assist performance", source: "# Math assist performance")

    visit edit_document_path(document)
    page.driver.browser.manage.timeouts.script_timeout = 30
    result = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      (async () => {
        try {
          const source = document.querySelector(".source-field");
          const editor = source.editorController;
          const shorthand = Stimulus.getControllerForElementAndIdentifier(source, "math-shorthand");
          const palette = Stimulus.getControllerForElementAndIdentifier(source, "math-shortcut-palette");
          const { ensureSyntaxTree } = await import("@codemirror/language");
          editor.setEditingMode("source", { silent: true });
          editor.vimEnabled = false;

          const prefix = "$" + "x+".repeat(2496);
          editor.setExternalValue(prefix + "x.b.vec");
          editor.setSelectionRange(editor.value.length);
          const parsedTree = ensureSyntaxTree(editor.view.state, editor.view.state.doc.length, 1000);
          if (!parsedTree || parsedTree.length < editor.view.state.doc.length) {
            throw new Error("CodeMirror did not parse the full 5,000-character math region");
          }

          const timings = [];
          let maximumRegionLength = 0;
          for (let index = 0; index < 1010; index += 1) {
            const suffix = index % 2 === 0 ? "x.b" : "x.b.vec";
            const from = prefix.length;
            editor.view.dispatch({
              changes: { from, to: editor.view.state.doc.length, insert: suffix },
              selection: { anchor: from + suffix.length },
              userEvent: "input"
            });
            maximumRegionLength = Math.max(maximumRegionLength, editor.view.state.doc.length);

            const before = performance.now();
            shorthand.keydown({ key: "x", defaultPrevented: false });
            palette.queryAtCaret();
            const elapsed = performance.now() - before;
            if (index >= 10) timings.push(elapsed);
          }

          const sorted = timings.toSorted((left, right) => left - right);
          done({
            samples: timings.length,
            maximumRegionLength,
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)],
            maximum: sorted.at(-1)
          });
        } catch (error) {
          done({ error: String(error?.stack || error) });
        }
      })();
    JAVASCRIPT

    assert_nil result["error"], "browser benchmark failed: #{result['error']}"
    assert_equal 1000, result["samples"]
    assert_equal 5000, result["maximumRegionLength"]
    assert_operator result["p95"], :<, 5
    assert_operator result["p99"], :<, 10
    assert_operator result["maximum"], :<, 16
  end

  test "inserts an equation block from the source command palette" do
    document = Document.create!(title: "Authoring snippets", source: "# Authoring snippets")

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    editor.click
    editor.send_keys("\n/equation")
    assert_selector ".snippet-palette .snippet-option", text: /Equation/, wait: 5
    editor.send_keys(:enter)

    source = find_field("Markdown source").value
    assert_includes source, "$$\nequation\n$$"
  end

  test "front matter can be revealed and hidden again on demand" do
    document = Document.create!(
      title: "Metadata notes",
      source: "---\ntheme: dark\ntypography: modern\n---\n# Metadata notes\n\nBody"
    )

    visit edit_document_path(document)
    assert_selector ".cm-foldPlaceholder", wait: 5
    assert_no_selector "button.editor-reveal-metadata", visible: true
    click_on "Source"
    assert_no_selector ".cm-foldPlaceholder"
    assert_selector ".editor-reveal-metadata", text: "Hide source metadata", visible: true
    assert_no_selector ".cm-foldPlaceholder"
    assert_selector ".cm-content", text: "theme: dark"

    click_on "Hide source metadata"
    assert_selector ".cm-foldPlaceholder"

    click_on "Reveal source metadata"
    assert_no_selector ".cm-foldPlaceholder"
  end

  test "appearance changes update visible source metadata" do
    document = Document.create!(
      title: "Appearance metadata",
      source: "---\ntheme: light\ntypography: book\n---\n# Appearance metadata\n\nBody"
    )

    visit edit_document_path(document)
    assert_selector "summary.editor-reveal-metadata", text: "Appearance", visible: true
    assert_no_selector "button.editor-reveal-metadata", text: "Reveal source metadata", visible: true
    assert_no_selector "select#document_theme", visible: true
    find("summary.editor-reveal-metadata", text: "Appearance").click
    assert_selector "select#document_theme", visible: true
    select "Dark", from: "Theme"
    select "Modern", from: "Typography"

    assert_selector ".document-reader.document-theme-dark.document-typography-modern", wait: 5
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 5
    assert_match /^theme: dark\r?$/m, find_field("Markdown source").value
    assert_match /^typography: modern\r?$/m, find_field("Markdown source").value
    assert_match /^theme: dark\r?$/m, document.reload.source
    assert_match /^typography: modern\r?$/m, document.reload.source
    refute_match /^theme: light\r?$/m, find_field("Markdown source").value
    refute_match /^typography: book\r?$/m, find_field("Markdown source").value
  end

  test "appearance controls and metadata toggle follow the editing mode" do
    document = Document.create!(
      title: "Mode bound appearance",
      source: "---\ntheme: light\ntypography: book\n---\n# Mode bound appearance\n\nBody"
    )

    visit edit_document_path(document)
    assert_selector "summary.editor-reveal-metadata", text: "Appearance", visible: true
    assert_no_selector "select#document_theme", visible: true
    assert_no_selector "select#document_typography", visible: true
    assert_no_selector "button.editor-reveal-metadata", text: "Reveal source metadata", visible: true

    find("summary.editor-reveal-metadata", text: "Appearance").click
    assert_selector "select#document_theme", visible: true
    assert_selector "select#document_typography", visible: true
    assert_selector ".appearance-hint", visible: true
    assert_equal "rgb(17, 22, 26)", page.evaluate_script("getComputedStyle(document.querySelector('select#document_theme')).backgroundColor")

    click_on "Source"
    assert_no_selector "summary.editor-reveal-metadata", text: "Appearance", visible: true
    assert_no_selector "select#document_theme", visible: true
    assert_no_selector "select#document_typography", visible: true
    assert_no_selector ".appearance-hint", visible: true
    assert_selector ".editor-reveal-metadata", text: "Hide source metadata", visible: true
    assert_equal "true", page.evaluate_script("document.querySelector('#document_theme').disabled").to_s

    type_source_text(document.source, "theme: light", "theme: dark")
    assert_selector ".document-reader.document-theme-dark", wait: 5

    click_on "Visual"
    assert_selector "summary.editor-reveal-metadata", text: "Appearance", visible: true
    find("summary.editor-reveal-metadata", text: "Appearance").click
    assert_selector "select#document_theme", visible: true
    assert_selector ".appearance-hint", visible: true
    assert_equal "dark", page.evaluate_script("document.querySelector('#document_theme').value")
    assert_no_selector "button.editor-reveal-metadata", text: "Reveal source metadata", visible: true
  end

  test "saving a source mode metadata edit preserves the source mode" do
    document = Document.create!(
      title: "Source mode metadata save",
      source: "---\ntheme: light\ntypography: book\n---\n# Source mode metadata save\n\nBody"
    )

    visit edit_document_path(document)
    click_on "Source"
    type_source_text(document.source, "theme: light", "theme: dark")
    assert_selector ".document-reader.document-theme-dark", wait: 5
    assert_equal "source", page.evaluate_script("document.querySelector('[name=editor_mode]').value")
    click_on "Save document"

    assert_selector ".flash.notice", text: "Document saved.", wait: 10
    assert_includes page.current_url, "editor_mode=source"
    assert_equal "source", page.evaluate_script("document.querySelector('.visual-editor-form').dataset.editorMode")
    assert_selector ".editor-mode-button[aria-pressed='true']", text: "Source"
    assert_selector ".editor-reveal-metadata", text: "Hide source metadata", visible: true
    assert_no_selector "select#document_theme", visible: true
    assert_match /^theme: dark\r?$/m, document.reload.source
  end

  test "keeps visual editing and the source-left preview-right layout usable at desktop and narrow widths" do
    document = Document.create!(title: "Responsive editor", source: "# Responsive editor\n\nBody")

    visit edit_document_path(document)
    assert_selector ".editor-shell"
    assert_selector ".editor-projection", visible: true
    assert_selector ".editor-mode-button.is-active", text: "Visual"
    assert_selector ".editor-layout .source-pane"

    page.driver.browser.manage.window.resize_to(1400, 900)
    click_on "Source"
    assert_selector ".editor-mode-button[aria-pressed='true']", text: "Source"
    assert_selector ".editor-projection[aria-label='Rendered preview']", visible: true

    desktop = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const source = document.querySelector('.source-pane').getBoundingClientRect();
        const projection = document.querySelector(".editor-projection").getBoundingClientRect();
        return {
          sourceLeft: source.left,
          sourceRight: source.right,
          sourceWidth: source.width,
          previewLeft: projection.left,
          projection: projection.width,
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth
        };
      })()
    JAVASCRIPT
    assert_operator desktop["sourceWidth"], :>, 0
    assert_operator desktop["sourceRight"], :<=, desktop["previewLeft"]
    assert_operator desktop["projection"], :>, 0
    assert_operator desktop["document"], :<=, desktop["viewport"] + 1

    page.driver.browser.manage.window.resize_to(700, 900)
    narrow = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const source = document.querySelector('.source-pane').getBoundingClientRect();
        const projection = document.querySelector(".editor-projection").getBoundingClientRect();
        return {
          sourceBottom: source.bottom,
          previewTop: projection.top,
          sourceWidth: source.width,
          projection: projection.width,
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth
        };
      })()
    JAVASCRIPT
    assert_operator narrow["sourceWidth"], :>, 0
    assert_operator narrow["sourceBottom"], :<=, narrow["previewTop"] + 1
    assert_operator narrow["projection"], :>, 0
    assert_operator narrow["document"], :<=, narrow["viewport"] + 1

    click_on "Visual"
    assert_selector ".editor-mode-button[aria-pressed='true']", text: "Visual"
    assert_selector ".editor-projection[aria-label='Visual editing surface']", visible: true
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "source mode keeps the first document page within the side preview width" do
    visit new_document_path
    page.driver.browser.manage.window.resize_to(1400, 900)
    click_on "Source"

    geometry = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const preview = document.querySelector(".editor-projection").getBoundingClientRect();
        const page = document.querySelector(".document-page").getBoundingClientRect();
        return { previewLeft: preview.left, previewRight: preview.right, pageLeft: page.left, pageRight: page.right };
      })()
    JAVASCRIPT

    assert_operator geometry["pageLeft"], :>=, geometry["previewLeft"]
    assert_operator geometry["pageRight"], :<=, geometry["previewRight"]
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  private

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
end
