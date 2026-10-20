require "application_system_test_case"

class VimEditorTest < ApplicationSystemTestCase
  test "editor controls fit a narrow viewport and retain resizing" do
    document = Document.create!(title: "Mobile editor", source: "# Mobile")
    page.driver.browser.execute_cdp("Emulation.clearDeviceMetricsOverride")
    page.driver.browser.manage.window.resize_to(1400, 1000)
    visit edit_document_path(document)
    [500, 390, 320].each do |width|
      page.driver.browser.execute_cdp("Emulation.setDeviceMetricsOverride", width: width, height: 800, deviceScaleFactor: 1, mobile: false)
      metrics = page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const viewport = window.innerWidth;
          const overflow = [...document.querySelectorAll("body *")].map((element) => {
            const rect = element.getBoundingClientRect();
            return { tag: element.tagName, className: String(element.className).slice(0, 80), left: rect.left, right: rect.right,
              width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
          }).filter((element) => element.width > 0 && (element.left < -1 || element.right > viewport + 1))
            .sort((left, right) => right.right - left.right).slice(0, 8);
          return { viewport, scrollWidth: document.documentElement.scrollWidth, overflow };
        })()
      JAVASCRIPT
      assert_operator metrics["scrollWidth"], :<=, metrics["viewport"], "emulated width #{width}: #{metrics.inspect}"
    end

    page.driver.browser.execute_cdp("Emulation.setDeviceMetricsOverride", width: 500, height: 800, deviceScaleFactor: 1, mobile: false)
    page.evaluate_script("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    assert_equal "vertical", page.evaluate_script("getComputedStyle(document.querySelector('.editor-surface')).resize")
    assert_equal "hidden", page.evaluate_script("getComputedStyle(document.querySelector('.editor-surface')).overflow")
    assert_equal "none", page.evaluate_script("getComputedStyle(document.querySelector('.editor-input-proxy')).resize")
    geometry = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const surface = document.querySelector('.source-field .editor-surface').getBoundingClientRect();
        const source = document.querySelector('.source-field').getBoundingClientRect();
        const toolbar = document.querySelector('.editor-toolbar').getBoundingClientRect();
        const projection = document.querySelector('.editor-projection').getBoundingClientRect();
        const editor = document.querySelector('.source-field .cm-editor').getBoundingClientRect();
        const fieldStyle = getComputedStyle(document.querySelector('.source-field'));
        return {
          surface: { top: surface.top, bottom: surface.bottom, height: surface.height, position: getComputedStyle(document.querySelector('.editor-surface')).position },
          source: { top: source.top, bottom: source.bottom, height: source.height, position: fieldStyle.position },
          toolbar: { top: toolbar.top, bottom: toolbar.bottom, height: toolbar.height },
          editor: { top: editor.top, bottom: editor.bottom, height: editor.height },
          projectionTop: projection.top,
          configuredToolbarHeight: document.querySelector('.source-field').style.getPropertyValue('--editor-toolbar-height'),
          configuredSurfaceHeight: document.querySelector('.source-field').style.getPropertyValue('--editor-surface-height')
        };
      })()
    JAVASCRIPT
    assert_operator geometry.dig("surface", "bottom"), :<=, geometry["projectionTop"], geometry.inspect
  ensure
    page.driver.browser.execute_cdp("Emulation.clearDeviceMetricsOverride")
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "Vim mode transitions and edits synchronize the Rails source" do
    document = Document.create!(title: "Vim notes", source: "# First\n# Second\n# Third")
    visit settings_path
    find("#vim-enabled").check
    visit edit_document_path(document)

    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys("i")
    assert_selector "[data-editor-target='mode'][data-mode='insert']", text: "Insert"
    editor.send_keys("Inserted ", :escape)
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    editor.send_keys("v", "l")
    assert_selector "[data-editor-target='mode'][data-mode='visual']", text: "Visual"
    editor.send_keys(:escape)

    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys("dd")
    assert_equal "# Second\n# Third", find_field("Markdown source").value
    assert_selector "[data-autosave-target='status']", text: "Saved", wait: 5
  end

  test "one Escape press closes each fuzzy popup and enters Vim Normal mode" do
    Document.create!(title: "Escape link target", source: "# Target")
    document = Document.create!(title: "Escape popups", source: "---\ntheme: \n---\n# Notes")
    visit settings_path
    find("#vim-enabled").check

    visit edit_document_path(document)
    click_on "Source"
    editor = find(".cm-content")
    focus_at_end = <<~JAVASCRIPT
      (() => {
        const controller = document.querySelector('.source-field').editorController;
        controller.setSelectionRange(controller.value.length);
        controller.focus();
      })()
    JAVASCRIPT
    page.execute_script(focus_at_end)
    editor.send_keys("i")
    assert_selector "[data-editor-target='mode'][data-mode='insert']", text: "Insert"

    # Slash snippet popup (: and / share this controller).
    editor.send_keys("\n/table")
    assert_selector "[data-snippet-palette-target='palette']:not([hidden]) .snippet-option", text: /Table/, wait: 5
    editor.send_keys(:escape)
    assert_no_selector "[data-snippet-palette-target='palette']:not([hidden])", wait: 5
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    # At-sign math shortcut popup (also a pending math shorthand chain).
    editor.send_keys("i", "\n$@a")
    assert_selector ".math-shortcut-option.is-selected", text: /Alpha/, wait: 5
    page.save_screenshot("../../assets/pr-shots/single-escape-dismiss/escape-math-popup-open.png")
    editor.send_keys(:escape)
    assert_no_selector "[data-math-shortcut-palette-target='palette']:not([hidden])", wait: 5
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    assert_includes find_field("Markdown source").value, "$@a"
    page.save_screenshot("../../assets/pr-shots/single-escape-dismiss/escape-math-normal-mode.png")

    # Double-bracket document link popup.
    editor.send_keys("i", "\n[[Escape li")
    assert_selector ".document-link-option", text: "Escape link target", wait: 5
    editor.send_keys(:escape)
    assert_no_selector "[data-document-link-palette-target='palette']:not([hidden])", wait: 5
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    # Slash mermaid assist popup (needs the caret at the end of its line).
    page.execute_script(focus_at_end)
    editor.send_keys("i", "\n/diagram")
    assert_selector "[data-mermaid-assist-target='palette']:not([hidden])", wait: 5
    editor.send_keys(:escape)
    assert_no_selector "[data-mermaid-assist-target='palette']:not([hidden])", wait: 5
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    # YAML front-matter metadata popup.
    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const controller = document.querySelector('.source-field').editorController;
        const caret = controller.value.indexOf('theme: ') + 'theme: '.length;
        controller.setSelectionRange(caret);
        controller.focus();
      })()
    JAVASCRIPT
    editor.send_keys("i", "d")
    assert_selector "[data-metadata-assist-target='palette']:not([hidden])", text: /dark/, wait: 5
    editor.send_keys(:escape)
    assert_no_selector "[data-metadata-assist-target='palette']:not([hidden])", wait: 5
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
  ensure
    page.execute_script("localStorage.clear()")
  end

  test "Vim caret position survives visual source switches and its cursor stays out of the visual surface" do
    document = Document.create!(title: "Vim caret handoff", source: "# Vim handoff\n\nBody")
    visit edit_document_path(document)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh

    block = find(".document-editor-block", text: "Body")
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      const text = block.querySelector("p").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 2);
    JAVASCRIPT

    click_on "Source"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    expected = document.source.index("Body") + 2
    assert_equal expected, page.evaluate_script("document.querySelector('.source-field').editorController.view.state.selection.main.head")
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    click_on "Visual"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal "none", page.evaluate_script("getComputedStyle(document.querySelector('.cm-vimCursorLayer')).display")
    assert_equal 2, page.evaluate_script("window.getSelection().focusOffset")

    click_on "Source"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    find(".cm-content").send_keys("i")
    assert_selector "[data-editor-target='mode'][data-mode='insert']", text: "Insert"

    click_on "Visual"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal 2, page.evaluate_script("window.getSelection().focusOffset")
    click_on "Source"
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_selector "[data-editor-target='mode'][data-mode='insert']", text: "Insert"
    find(".cm-content").send_keys("!")
    assert_field "Markdown source", with: "# Vim handoff\n\nBo!dy", wait: 5
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim visual mode keeps the empty engine panels hidden and the projection in view" do
    document = Document.create!(title: "Vim panels", source: "A *warm* word.")
    visit edit_document_path(document)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector ".editor-projection .document-editor-block", wait: 10
    # CodeMirror copies editor theme classes onto the custom panel container;
    # JS-injected theme rules must not paint the empty container over the page.
    assert_equal "none", page.evaluate_script("getComputedStyle(document.querySelector('.visual-engine-panels')).display")
    projection_top = page.evaluate_script("document.querySelector('.editor-projection').getBoundingClientRect().top")
    assert_operator projection_top, :<, page.evaluate_script("window.innerHeight")
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim visual mode highlights horizontal selections with the Aradia palette" do
    document = Document.create!(title: "Visual selection", source: "abcdef\nsecond line")
    visit settings_path
    find("#vim-enabled").check
    visit edit_document_path(document, editor_mode: "source")

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(3, 3)")
    editor.send_keys("v", "h")
    assert_selector "[data-editor-target='mode'][data-mode='visual']", text: "Visual"

    selection = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController
        const selected = document.querySelector('.cm-selectionBackground')
        const bounds = selected?.getBoundingClientRect()
        return {
          from: editor.view.state.selection.main.from,
          to: editor.view.state.selection.main.to,
          background: selected && getComputedStyle(selected).backgroundColor,
          width: bounds?.width || 0
        }
      })()
    JAVASCRIPT

    assert_operator selection["to"], :>, selection["from"]
    assert_operator selection["width"], :>, 0
    editor.send_keys("h")
    page.evaluate_async_script("window.requestAnimationFrame(() => arguments[0]())")
    extended_selection = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController
        const selected = document.querySelector('.cm-selectionBackground')
        return {
          from: editor.view.state.selection.main.from,
          to: editor.view.state.selection.main.to,
          background: selected && getComputedStyle(selected).backgroundColor,
          width: selected?.getBoundingClientRect().width || 0
        }
      })()
    JAVASCRIPT
    assert_operator extended_selection["to"] - extended_selection["from"], :>, selection["to"] - selection["from"]
    assert_operator extended_selection["width"], :>, selection["width"]
    assert_equal "rgba(159, 197, 169, 0.42)", extended_selection["background"]
  end

  test "Vim visual mode paints the engine range on the rendered text" do
    document = Document.create!(title: "Visual selection", source: "abcdef\nsecond line")
    visit settings_path
    find("#vim-enabled").check
    visit edit_document_path(document)

    block = find(".document-editor-block", text: "abcdef")
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      const text = block.querySelector("p").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 3);
      document.querySelector('.source-field').editorController.setSelectionRange(3, 3);
    JAVASCRIPT
    page.driver.browser.action.send_keys("v", "h", "h").perform
    assert_selector "[data-editor-target='mode'][data-mode='visual']", text: "Visual"

    painted = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const selection = window.getSelection();
        const layer = document.querySelector('.cm-selectionLayer');
        return {
          collapsed: selection.isCollapsed,
          text: selection.toString(),
          inPassage: Boolean(selection.anchorNode?.parentElement?.closest?.(".document-editor-block")),
          stripHidden: !layer || getComputedStyle(layer).display === "none"
        };
      })()
    JAVASCRIPT
    assert_equal false, painted["collapsed"]
    assert_equal "bcd", painted["text"]
    assert_equal true, painted["inPassage"]
    assert_equal true, painted["stripHidden"]

    # Operating on the painted range edits the engine source exactly once.
    page.driver.browser.action.send_keys("d").perform
    assert_field "Markdown source", with: "aef\nsecond line", wait: 5
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
  end

  test "Vim normal mode shows an on-character block on the rendered text" do
    document = Document.create!(title: "Normal caret", source: "abcdef\nsecond line")
    visit settings_path
    find("#vim-enabled").check
    visit edit_document_path(document)

    block = find(".document-editor-block", text: "abcdef")
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      const text = block.querySelector("p").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 2);
      document.querySelector('.source-field').editorController.setSelectionRange(2, 2);
    JAVASCRIPT
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    indicator = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const overlay = document.querySelector('.elef-vim-normal-caret');
        const rect = overlay?.getBoundingClientRect();
        const range = document.createRange();
        const text = document.querySelector('.document-editor-block p').firstChild;
        range.setStart(text, 2);
        range.setEnd(text, 3);
        const char = range.getBoundingClientRect();
        return {
          display: overlay ? getComputedStyle(overlay).display : null,
          matches: rect && Math.abs(rect.x - char.x) < 1 && Math.abs(rect.width - char.width) < 1
        };
      })()
    JAVASCRIPT
    assert_equal "block", indicator["display"]
    assert_equal true, indicator["matches"]

    # Insert mode drops the block; Escape restores it.
    page.driver.browser.action.send_keys("i").perform
    assert_selector "[data-editor-target='mode'][data-mode='insert']", text: "Insert"
    assert_equal "none", page.evaluate_script("getComputedStyle(document.querySelector('.elef-vim-normal-caret')).display")
    page.driver.browser.action.send_keys(:escape).perform
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    assert_equal "block", page.evaluate_script("getComputedStyle(document.querySelector('.elef-vim-normal-caret')).display")
  end

  test "Vim settings persist per browser" do
    document = Document.create!(title: "Vim settings", source: "# Settings")
    visit settings_path

    find("#vim-enabled").check
    visit edit_document_path(document)

    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    visit settings_path
    assert_selector "#vim-enabled:checked"
    assert_no_selector "[data-editor-target='mapping']"
  end

  test "uses one configured Vim Escape remap and ignores legacy Normal mappings" do
    document = Document.create!(title: "Unified Vim Escape", source: "# One two")
    visit edit_document_path(document)
    page.execute_script(<<~JAVASCRIPT)
      localStorage.clear();
      localStorage.setItem("elef.editor.vim.enabled", "true");
      localStorage.setItem("elef.editor.vim.normalMapping", "insert");
      localStorage.setItem("elef.editor.vim.escapeKey", "<C-CR>");
    JAVASCRIPT
    page.refresh

    editor = find(".cm-content")
    editor.click
    editor.send_keys([:shift, :space])
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    editor.send_keys("i", "Alias", [:control, :enter])
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    editor.send_keys("v", "l", [:control, :enter])
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    source_before_escape = find_field("Markdown source").value
    editor.send_keys("d", [:control, :enter], "w")
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    assert_equal source_before_escape, find_field("Markdown source").value
  ensure
    page.execute_script("localStorage.clear()")
  end

  test "customizes Vim Escape, line numbers, cursor styling, and persists" do
    document = Document.create!(title: "Expanded Vim settings", source: "# Settings\nSecond\nThird\nFourth")
    visit settings_path
    page.execute_script("localStorage.clear()")
    page.refresh

    escape_key = find("#vim-escape-key")
    escape_key.click
    escape_key.send_keys([:shift, :space])
    assert_equal "Shift+Space", escape_key.value

    select "Hidden", from: "Line numbers"
    visit edit_document_path(document)
    assert_equal "none", page.evaluate_script("getComputedStyle(document.querySelector('.cm-lineNumbers')).display")

    visit settings_path
    select "Relative", from: "Line numbers"
    check "Mode-aware cursor styling"
    check "Enable Vim mode"

    visit edit_document_path(document)

    select_option = page.evaluate_script("document.querySelector('.editor-surface').dataset.lineNumbers")
    assert_equal "relative", select_option
    assert_equal "true", page.evaluate_script("document.querySelector('.editor-surface').dataset.modeAwareCursor")

    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    line_numbers = <<~JAVASCRIPT
      [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
        .filter((element) => element.style.visibility !== 'hidden')
        .map((element) => element.textContent)
    JAVASCRIPT
    page.evaluate_async_script("window.requestAnimationFrame(() => arguments[0]())")
    assert_equal %w[0 1 2 3], page.evaluate_script(line_numbers)
    page.execute_script("const editor = document.querySelector('.source-field').editorController; editor.setSelectionRange(editor.value.indexOf('Third'))")
    page.evaluate_async_script("window.requestAnimationFrame(() => arguments[0]())")
    assert_equal %w[2 1 0 1], page.evaluate_script(line_numbers)

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys("i")
    assert_equal "rgb(215, 194, 142)", page.evaluate_script("getComputedStyle(document.querySelector('.cm-cursor')).borderLeftColor")
    editor.send_keys("Alias", [:shift, :space])
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    assert_equal "rgb(159, 197, 169)", page.evaluate_script("getComputedStyle(document.querySelector('.cm-cursor')).borderLeftColor")
    editor.send_keys("v", "l")
    assert_selector "[data-editor-target='mode'][data-mode='visual']", text: "Visual"
    assert_equal "rgb(196, 214, 202)", page.evaluate_script("getComputedStyle(document.querySelector('.cm-cursor')).borderLeftColor")
    editor.send_keys([:shift, :space])
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    source_before_normal_escape = find_field("Markdown source").value
    editor.send_keys("d", [:shift, :space], "w")
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    assert_equal source_before_normal_escape, find_field("Markdown source").value

    visit settings_path
    assert_equal "relative", find("#vim-line-numbers").value
    assert_selector "#vim-mode-aware-cursor:checked"
    assert_equal "Shift+Space", find("#vim-escape-key").value
  ensure
    page.execute_script("localStorage.clear()")
  end

  test "metadata directives use the same styling as Markdown markers" do
    document = Document.create!(title: "Metadata styling", source: <<~MARKDOWN)
      # Notes

      > A quote

      **Bold**

      :::align{center}

      Visible text.

      ```
      :::not-metadata
      ```
    MARKDOWN
    visit edit_document_path(document)

    # Invisible directives collapse until entered (reveal-in-place), so each
    # marker line is entered in turn; revealed syntax keeps its active mark
    # and true token colors instead of the dimmed inactive-marker color.
    styles = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        const find = (text) => [...document.querySelectorAll(".cm-line span")].find((node) => node.textContent.trim() === text)
        const reveal = (text) => {
          editor.setSelectionRange(editor.value.indexOf(text));
          return find(text);
        }

        const metadata = reveal(":::align{center}")
        const heading = reveal("#")
        const quote = reveal(">")
        const strong = reveal("**")
        const metadataClasses = metadata ? [...metadata.classList] : []
        const sharedClass = metadataClasses.find((className) => [heading, quote, strong].every((node) => node?.classList.contains(className)))

        return {
          metadata: metadata?.className,
          heading: heading?.className,
          quote: quote?.className,
          strong: strong?.className,
          sharedClass,
          fenced: find(":::not-metadata")?.className ?? null
        }
      })()
    JAVASCRIPT

    assert_equal "cm-live-active-syntax", styles["sharedClass"]
    assert_nil styles["fenced"]
  end

  test "live preview leaves Markdown-looking code literal in fenced and inline code" do
    source = <<~MARKDOWN
      # Literal code

      ```markdown
      **bold** *italic* $x$ $$y$$ [link](/path) ![image](/image.svg) [[document]]
      ```

      Inline code: `$z$ **not bold**`
    MARKDOWN
    document = Document.create!(title: "Literal code", source: source)

    visit edit_document_path(document)

    assert_field "Markdown source", with: source
    code_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const fencedLine = [...document.querySelectorAll('.cm-line.cm-live-code-line')]
          .find((line) => line.textContent.includes('**bold**'));
        const inlineCode = [...document.querySelectorAll('.cm-live-inline-code')]
          .find((node) => node.textContent.includes('$z$'));
        const previewSyntax = '.cm-live-strong, .cm-live-emphasis, .cm-live-link, .cm-live-document-link, .cm-live-widget-math, .cm-live-image';
        return {
          fencedText: fencedLine?.textContent,
          fencedDecorations: fencedLine?.querySelector(previewSyntax) !== null,
          inlineText: inlineCode?.textContent,
          inlineDecorations: inlineCode?.querySelector(previewSyntax) !== null
        };
      })()
    JAVASCRIPT

    assert_equal "**bold** *italic* $x$ $$y$$ [link](/path) ![image](/image.svg) [[document]]", code_state["fencedText"]
    refute code_state["fencedDecorations"]
    assert_equal "$z$ **not bold**", code_state["inlineText"]
    refute code_state["inlineDecorations"]
  end

  test "live preview reveals syntax around the active source range" do
    document = Document.create!(title: "Active syntax", source: "# Heading\n\n**Bold**")
    visit edit_document_path(document)

    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.setSelectionRange(editor.value.indexOf('Bold') + 1);
    JAVASCRIPT

    active_syntax = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll('.cm-live-active-syntax')].map((element) => ({
        text: element.textContent,
        fontSize: getComputedStyle(element).fontSize,
        color: getComputedStyle(element).color
      }))
    JAVASCRIPT
    assert active_syntax.any? { |entry| entry["text"].include?("*") }
    refute active_syntax.any? { |entry| entry["fontSize"] == "0px" }
  end

  test "Vim edits update a presentation preview and autosave" do
    presentation = Presentation.create!(title: "Vim work", source: "# Original")
    visit settings_path
    find("#vim-enabled").check

    visit edit_presentation_path(presentation)

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(2, 2)")
    editor.send_keys("i", "Vim ", :escape)

    assert_selector ".preview-pane .slide", text: "Vim Original", wait: 5
    assert_selector "[data-autosave-target='status']", text: "Saved", wait: 5
    assert_includes presentation.reload.source, "# Vim Original"
  ensure
    page.execute_script("localStorage.clear()")
  end

  test "turning Vim off restores ordinary editing" do
    document = Document.create!(title: "Standard editing", source: "# Standard")
    visit settings_path
    find("#vim-enabled").check
    find("#vim-enabled").uncheck

    visit edit_document_path(document)
    assert_selector "[data-editor-target='mode'][data-mode='standard']", text: "Standard"

    editor = find(".cm-content")
    editor.click
    editor.send_keys(" ordinary")
    assert_includes find_field("Markdown source").value, " ordinary"
  ensure
    page.execute_script("localStorage.clear()")
  end

  test "Vim cursor is visible on empty lines in normal and visual mode" do
    document = Document.create!(title: "Empty line cursor", source: "# First\n\n# Third\n")
    visit settings_path
    find("#vim-enabled").check

    visit edit_document_path(document, editor_mode: "source")

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys(:escape)

    # Move down to the middle empty line (line 2)
    editor.send_keys("j")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    normal_cursor = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const fat = document.querySelector('.cm-vimCursorLayer .cm-fat-cursor');
        if (!fat) return null;
        const rect = fat.getBoundingClientRect();
        return {
          present: true,
          width: rect.width,
          height: rect.height,
          bg: getComputedStyle(fat).backgroundColor
        };
      })()
    JAVASCRIPT

    assert normal_cursor["present"]
    assert_operator normal_cursor["width"], :>, 0
    assert_operator normal_cursor["height"], :>, 0
    assert_equal "rgb(159, 197, 169)", normal_cursor["bg"]

    # Enter visual mode on the empty line
    editor.send_keys("v")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    visual_cursor = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const fat = document.querySelector('.cm-vimCursorLayer .cm-fat-cursor');
        if (!fat) return null;
        const rect = fat.getBoundingClientRect();
        return {
          present: true,
          width: rect.width,
          height: rect.height
        };
      })()
    JAVASCRIPT

    assert visual_cursor["present"]
    assert_operator visual_cursor["width"], :>, 0
    assert_operator visual_cursor["height"], :>, 0

    # Return to normal mode and navigate to the trailing empty line
    editor.send_keys(:escape, "G")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    trailing_cursor = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const fat = document.querySelector('.cm-vimCursorLayer .cm-fat-cursor');
        if (!fat) return null;
        const rect = fat.getBoundingClientRect();
        return {
          present: true,
          width: rect.width,
          height: rect.height
        };
      })()
    JAVASCRIPT

    assert trailing_cursor["present"]
    assert_operator trailing_cursor["width"], :>, 0
    assert_operator trailing_cursor["height"], :>, 0
  ensure
    page.execute_script("localStorage.clear()")
  end

  test "Vim selection highlight is visible on active lines for visual mode and mouse drag" do
    document = Document.create!(title: "Visual selection visibility", source: "First line of text\nSecond line of text")
    visit settings_path
    find("#vim-enabled").check

    visit edit_document_path(document, editor_mode: "source")

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys(:escape)

    # 1. Visual mode selection with v + l movements
    editor.send_keys("v", "l", "l", "l")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    visual_selection = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const selected = document.querySelector('.cm-selectionBackground');
        const activeLine = document.querySelector('.cm-activeLine');
        return {
          present: Boolean(selected),
          width: selected ? selected.getBoundingClientRect().width : 0,
          selectionBg: selected ? getComputedStyle(selected).backgroundColor : null,
          activeLineBg: activeLine ? getComputedStyle(activeLine).backgroundColor : null
        };
      })()
    JAVASCRIPT

    assert visual_selection["present"]
    assert_operator visual_selection["width"], :>, 0
    assert_equal "rgba(159, 197, 169, 0.42)", visual_selection["selectionBg"]
    assert_equal "rgba(255, 255, 255, 0.035)", visual_selection["activeLineBg"]

    # 2. Mouse-drag selection on the second line
    editor.send_keys(:escape)
    line2 = find(".cm-line", text: "Second line of text")
    line2_rect = page.evaluate_script("arguments[0].getBoundingClientRect()", line2)

    page.driver.browser.action
      .move_to_location(line2_rect["left"].to_i + 20, line2_rect["top"].to_i + 10)
      .click_and_hold
      .move_by(70, 0)
      .perform

    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    drag_selection = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const selected = document.querySelector('.cm-selectionBackground');
        return {
          present: Boolean(selected),
          width: selected ? selected.getBoundingClientRect().width : 0,
          selectionBg: selected ? getComputedStyle(selected).backgroundColor : null
        };
      })()
    JAVASCRIPT

    page.driver.browser.action.release.perform

    assert drag_selection["present"]
    assert_operator drag_selection["width"], :>, 0
    assert_equal "rgba(159, 197, 169, 0.42)", drag_selection["selectionBg"]
  ensure
    page.execute_script("localStorage.clear()")
  end

  test "selection highlight is visible on active lines when Vim mode is off" do
    document = Document.create!(title: "Standard selection visibility", source: "Standard active line selection text")
    visit edit_document_path(document, editor_mode: "source")

    editor = find(".cm-content")
    editor.click

    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 8)")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    selection_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const selected = document.querySelector('.cm-selectionBackground');
        const activeLine = document.querySelector('.cm-activeLine');
        return {
          present: Boolean(selected),
          width: selected ? selected.getBoundingClientRect().width : 0,
          selectionBg: selected ? getComputedStyle(selected).backgroundColor : null,
          activeLineBg: activeLine ? getComputedStyle(activeLine).backgroundColor : null
        };
      })()
    JAVASCRIPT

    assert selection_state["present"]
    assert_operator selection_state["width"], :>, 0
    assert_equal "rgb(34, 51, 51)", selection_state["selectionBg"]
    assert_equal "rgba(255, 255, 255, 0.035)", selection_state["activeLineBg"]
  ensure
    page.execute_script("localStorage.clear()")
  end

  test "Vim normal-mode keys edit the source through the visual projection" do
    document = Document.create!(title: "Vim visual editing", source: "# Vim visual\n\nFirst paragraph.\n")
    visit edit_document_path(document)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh

    block = find(".document-editor-block", text: "First paragraph.")
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(block.querySelector("p").firstChild, 0);
    JAVASCRIPT

    # Normal-mode "x" deletes under the caret; plain typing would insert it.
    block.send_keys("x")
    assert_equal "# Vim visual\n\nirst paragraph.\n",
      page.evaluate_script("document.querySelector('.source-field').editorController.value")

    # The refresh holds while the block is focused, so the same node
    # persists; re-seat the caret and compose a motion plus an operator.
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(block.querySelector("p").firstChild, 0);
    JAVASCRIPT
    block.send_keys("lx")
    assert_field "Markdown source", with: "# Vim visual\n\nist paragraph.\n", wait: 5

    caret = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const selection = window.getSelection();
        return { collapsed: selection.isCollapsed, focusOffset: selection.focusOffset };
      })()
    JAVASCRIPT
    assert_equal true, caret["collapsed"]
    assert_equal 1, caret["focusOffset"]

    page.execute_script("document.activeElement.blur()")
    assert_selector ".document-editor-block", text: "ist paragraph.", wait: 10
  ensure
    page.execute_script("localStorage.clear()")
  end
end
