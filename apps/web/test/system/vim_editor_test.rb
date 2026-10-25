require "application_system_test_case"
require "base64"

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

  test "Vim j traverses visual blocks from top to bottom" do
    Document.create!(title: "Vim traverse", source: "# One\n# Two\n# Three")
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    first = find(".document-editor-block", text: "One")
    page.execute_script(<<~JAVASCRIPT, first)
      const block = arguments[0];
      const text = block.querySelector("h1, h2, h3, p, li").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 0);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    # One j per line: Two, then Three. Consecutive headings keep every
    # keypress on its own block so a stuck restore fails loudly.
    find(".document-editor-block", text: "One").send_keys("j", "j")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    focused = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const node = window.getSelection().focusNode;
        if (!node) return null;
        const element = node.nodeType === 1 ? node : node.parentElement;
        const block = element.closest("[data-editor-block-id]");
        return block ? block.textContent : null;
      })()
    JAVASCRIPT
    assert_includes focused, "Three"
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim j moves down table cells in the same column" do
    Document.create!(title: "Vim table", source: "| a | b |\n|---|---|\n| c | d |\n| e | f |")
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    first = find(".document-editor-block", text: "a")
    page.execute_script(<<~JAVASCRIPT, first)
      const block = arguments[0];
      const cell = block.querySelector("td, th");
      const text = cell.firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 0);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    page.save_screenshot("../../assets/pr-shots/visual-vim-table/table-vim-before-j.png")

    # One j steps over the delimiter row into the body row below,
    # same column: the caret must leave the header for cell "c".
    find(".document-editor-block", text: "a").send_keys("j")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    focused = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const node = window.getSelection().focusNode;
        if (!node) return null;
        const element = node.nodeType === 1 ? node : node.parentElement;
        const cell = element.closest("td, th");
        return cell ? { text: cell.textContent, index: cell.cellIndex } : null;
      })()
    JAVASCRIPT
    assert_includes focused["text"], "c"
    assert_equal 0, focused["index"]
    page.save_screenshot("../../assets/pr-shots/visual-vim-table/table-vim-after-j.png")
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim k traverses visual blocks from bottom to top" do
    Document.create!(title: "Vim traverse up", source: "# One\n# Two\n# Three")
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    last = find(".document-editor-block", text: "Three")
    page.execute_script(<<~JAVASCRIPT, last)
      const block = arguments[0];
      const text = block.querySelector("h1, h2, h3, p, li").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 0);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    # One k per line: Two, then One. A stuck restore fails loudly.
    find(".document-editor-block", text: "Three").send_keys("k", "k")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    focused = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const node = window.getSelection().focusNode;
        if (!node) return null;
        const element = node.nodeType === 1 ? node : node.parentElement;
        const block = element.closest("[data-editor-block-id]");
        return block ? block.textContent : null;
      })()
    JAVASCRIPT
    assert_includes focused, "One"
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim h and l move within lines and stop at edges without wraparound" do
    # Stock Vim (no whichwrap) holds h at the line start and l on the
    # last character; the visual editor must show exactly that. A
    # four-character line keeps every step on unambiguous engine
    # positions (mid-line display offsets map one-to-one).
    Document.create!(title: "Vim horizontal", source: "# ABCD")
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    first = find(".document-editor-block", text: "ABCD")
    page.execute_script(<<~JAVASCRIPT, first)
      const block = arguments[0];
      const text = block.querySelector("h1, h2, h3, p, li").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 2);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    caret = lambda do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const selection = window.getSelection();
          const node = selection.focusNode;
          return { text: node ? node.textContent : null, offset: selection.focusOffset };
        })()
      JAVASCRIPT
    end
    step = lambda do |keys|
      find(".document-editor-block", text: "ABCD").send_keys(*keys)
      page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    end

    # h walks back to the line start, then holds the display at 0 while
    # the engine crosses the concealed marker.
    step.call(["h"])
    assert_equal "ABCD", caret.call["text"]
    assert_equal 1, caret.call["offset"]

    step.call(["h"])
    assert_equal "ABCD", caret.call["text"]
    assert_equal 0, caret.call["offset"]

    step.call(["h", "h"])
    assert_equal "ABCD", caret.call["text"]
    assert_equal 0, caret.call["offset"]

    # l walks forward out of the marker to the last character, then
    # holds: the first two presses stay on display 0 (marker space,
    # then "A"), then each press advances one display cell.
    step.call(["l"])
    assert_equal "ABCD", caret.call["text"]
    assert_equal 0, caret.call["offset"]

    step.call(["l"])
    assert_equal "ABCD", caret.call["text"]
    assert_equal 0, caret.call["offset"]

    step.call(["l"])
    assert_equal "ABCD", caret.call["text"]
    assert_equal 1, caret.call["offset"]

    step.call(["l", "l"])
    assert_equal "ABCD", caret.call["text"]
    assert_equal 3, caret.call["offset"]

    step.call(["l"])
    assert_equal "ABCD", caret.call["text"]
    assert_equal 3, caret.call["offset"]
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim word motions w b e move across visual blocks" do
    Document.create!(title: "Vim words", source: "# One two\n# Three four")
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    first = find(".document-editor-block", text: "One two")
    page.execute_script(<<~JAVASCRIPT, first)
      const block = arguments[0];
      const text = block.querySelector("h1, h2, h3, p, li").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 0);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    caret = lambda do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const selection = window.getSelection();
          const node = selection.focusNode;
          return { text: node ? node.textContent : null, offset: selection.focusOffset };
        })()
      JAVASCRIPT
    end
    block = find(".document-editor-block", text: "One two")

    block.send_keys("w")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal "One two", caret.call["text"]
    assert_equal 4, caret.call["offset"]

    block.send_keys("w")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal "Three four", caret.call["text"]
    assert_equal 0, caret.call["offset"]

    # b steps back over the concealed "#" marker to the previous word in
    # one motion (engine-defined word motion, identical in source mode).
    find(".document-editor-block", text: "Three four").send_keys("b")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal "One two", caret.call["text"]
    assert_equal 4, caret.call["offset"]

    find(".document-editor-block", text: "One two").send_keys("e")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal "One two", caret.call["text"]
    assert_equal 6, caret.call["offset"]
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim dollar and zero reach rendered line ends" do
    Document.create!(title: "Vim line ends", source: "First paragraph here")
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    para = find(".document-editor-block", text: "First paragraph here")
    page.execute_script(<<~JAVASCRIPT, para)
      const block = arguments[0];
      const text = block.querySelector("h1, h2, h3, p, li").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 0);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    caret = lambda do
      page.evaluate_script("window.getSelection().focusOffset")
    end

    find(".document-editor-block", text: "First paragraph here").send_keys("$")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal "First paragraph here".length - 1, caret.call

    find(".document-editor-block", text: "First paragraph here").send_keys("0")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal 0, caret.call
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim gg and capital G jump between document top and bottom" do
    Document.create!(title: "Vim jumps", source: "# One\n# Two\n# Three\n# Four\n# Five")
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    middle = find(".document-editor-block", text: "Three")
    page.execute_script(<<~JAVASCRIPT, middle)
      const block = arguments[0];
      const text = block.querySelector("h1, h2, h3, p, li").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 0);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    focused = lambda do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const node = window.getSelection().focusNode;
          if (!node) return null;
          const element = node.nodeType === 1 ? node : node.parentElement;
          const block = element.closest("[data-editor-block-id]");
          return block ? block.textContent : null;
        })()
      JAVASCRIPT
    end

    find(".document-editor-block", text: "Three").send_keys("G")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_includes focused.call, "Five"

    find(".document-editor-block", text: "Five").send_keys("g", "g")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_includes focused.call, "One"
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim counts multiply motions across blocks" do
    Document.create!(title: "Vim counts", source: "# A\n# B\n# C\n# D\n# E\n# F")
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    first = find(".document-editor-block", text: "A")
    page.execute_script(<<~JAVASCRIPT, first)
      const block = arguments[0];
      const text = block.querySelector("h1, h2, h3, p, li").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 0);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    focused = lambda do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const node = window.getSelection().focusNode;
          if (!node) return null;
          const element = node.nodeType === 1 ? node : node.parentElement;
          const block = element.closest("[data-editor-block-id]");
          return block ? block.textContent : null;
        })()
      JAVASCRIPT
    end

    # Holding j from the top reaches the bottom: 3j lands on D.
    find(".document-editor-block", text: "A").send_keys("3j")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_includes focused.call, "D"

    find(".document-editor-block", text: "D").send_keys("2k")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_includes focused.call, "B"
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim visual mode extends the selection across blocks with j and k" do
    Document.create!(title: "Vim visual range", source: "# One\n# Two\n# Three")
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    first = find(".document-editor-block", text: "One")
    page.execute_script(<<~JAVASCRIPT, first)
      const block = arguments[0];
      const text = block.querySelector("h1, h2, h3, p, li").firstChild;
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(text, 0);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")

    # Native selection text does not serialize across block editing
    # hosts, so assert the range endpoints: anchor in the first block,
    # focus in the reached block. The failure screenshot shows the
    # painted highlight end to end.
    selection = lambda do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const selection = window.getSelection();
          return {
            collapsed: selection.isCollapsed,
            anchorText: selection.anchorNode ? selection.anchorNode.textContent : null,
            anchorOffset: selection.anchorOffset,
            focusText: selection.focusNode ? selection.focusNode.textContent : null,
            focusOffset: selection.focusOffset
          };
        })()
      JAVASCRIPT
    end

    find(".document-editor-block", text: "One").send_keys("v", "j", "j")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal false, selection.call["collapsed"]
    assert_equal "One", selection.call["anchorText"]
    assert_equal 0, selection.call["anchorOffset"]
    assert_equal "Three", selection.call["focusText"]
    assert_equal 1, selection.call["focusOffset"]
    page.save_screenshot("../../assets/pr-shots/visual-vim-table/visual-range-across-blocks.png")

    # k shrinks the range back toward the anchor. Focus returns to the
    # middle block; the exact intra-cell column is engine-defined
    # (shared with source mode by construction).
    find(".document-editor-block", text: "Three").send_keys("k")
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal false, selection.call["collapsed"]
    assert_equal "One", selection.call["anchorText"]
    assert_equal "Two", selection.call["focusText"]

    find(".document-editor-block", text: "Two").send_keys(:escape)
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    assert_equal true, selection.call["collapsed"]
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim navigates a filled 8 by 8 table by grid cells with hjkl and arrows" do
    header = "| #{(1..8).map { |c| "h#{c}" }.join(" | ")} |"
    delimiter = "|#{Array.new(8, "---").join("|")}|"
    rows = (1..8).map { |r| "| #{(1..8).map { |c| "r#{r}c#{c}" }.join(" | ")} |" }
    Document.create!(title: "Vim grid", source: ([header, delimiter] + rows).join("\n"))
    visit edit_document_path(Document.order(:id).last)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    block = find(".document-editor-block", text: "r1c1")
    page.execute_script(<<~JAVASCRIPT, block)
      const block = arguments[0];
      const cell = block.querySelectorAll("td, th")[8];
      block.focus({ preventScroll: true });
      window.getSelection().setPosition(cell.firstChild, 0);
    JAVASCRIPT
    page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    page.save_screenshot("../../assets/pr-shots/visual-vim-table/table-8x8-before.png")

    cell = lambda do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const node = window.getSelection().focusNode;
          if (!node) return null;
          const element = node.nodeType === 1 ? node : node.parentElement;
          const found = element.closest("td, th");
          return found ? { text: found.textContent, index: found.cellIndex } : null;
        })()
      JAVASCRIPT
    end
    settle = lambda do
      page.evaluate_async_script("requestAnimationFrame(() => requestAnimationFrame(() => arguments[0]()))")
    end

    # jjj stays in column 1 across three body rows.
    find(".document-editor-block", text: "r1c1").send_keys("j", "j", "j")
    settle.call
    assert_includes cell.call["text"], "r4c1"
    assert_equal 0, cell.call["index"]

    # kkk climbs back up the same column.
    find(".document-editor-block", text: "r4c1").send_keys("k", "k", "k")
    settle.call
    assert_includes cell.call["text"], "r1c1"
    assert_equal 0, cell.call["index"]

    # h/l are character motions (as in source Vim): l steps inside the
    # cell text, h steps back, neither leaves the cell mid-text.
    caret = lambda do
      page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const selection = window.getSelection();
          return { offset: selection.focusOffset };
        })()
      JAVASCRIPT
    end
    find(".document-editor-block", text: "r1c1").send_keys("l")
    settle.call
    assert_includes cell.call["text"], "r1c1"
    assert_equal 0, cell.call["index"]
    assert_equal 1, caret.call["offset"]

    find(".document-editor-block", text: "r1c1").send_keys("h")
    settle.call
    assert_equal 0, caret.call["offset"]

    # ArrowUp/ArrowDown are line motions: they must match j/k cell for
    # cell through the same grid.
    find(".document-editor-block", text: "r1c1").send_keys(:down, :down)
    settle.call
    assert_includes cell.call["text"], "r3c1"
    assert_equal 0, cell.call["index"]

    find(".document-editor-block", text: "r3c1").send_keys(:up)
    settle.call
    assert_includes cell.call["text"], "r2c1"
    assert_equal 0, cell.call["index"]
    page.save_screenshot("../../assets/pr-shots/visual-vim-table/table-8x8-after.png")

    # Cohesive authoring: an insert-mode edit inside the cell rewrites source.
    find(".document-editor-block", text: "r2c1").send_keys("i", "!", :escape)
    settle.call
    assert_field "Markdown source", with: /!r2c1/, wait: 10
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  test "Vim normal block never renders the upstream red, on any surface" do
    document = Document.create!(title: "Cursor guard", source: "abcdef\nsecond line")
    visit settings_path
    find("#vim-enabled").check
    visit edit_document_path(document)
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal", wait: 10

    # A bare Vim-enabled CodeMirror with no .editor-surface ancestor: the shape
    # every host reuses, carrying none of Elef's container-scoped overrides.
    # The web bundle vendor-patches the vim default to green, but the desktop
    # host bundles upstream unpatched (#ff9696, Prec.highest), which outranks
    # the engine theme on precedence and ties-then-beats the
    # .editor-surface-scoped stylesheet on injection order. The injected sheet
    # below replays that exact upstream configuration (same specificity
    # shapes, runtime-injected after the stylesheets): without Elef's
    # root-anchored guard the block computes red; with it, theme green.
    mount_result = page.evaluate_async_script(<<~JAVASCRIPT)
      (function (done) {
        (async () => {
          try {
            const { EditorView } = await import("@codemirror/view");
            const { vim } = await import("@replit/codemirror-vim");
            const mount = document.createElement("div");
            mount.id = "vim-guard-probe";
            mount.setAttribute("aria-label", "Vim cursor guard probe");
            mount.style.cssText = "position:fixed;left:16px;bottom:16px;width:22rem;z-index:60;" +
              "border:1px solid #304047;border-radius:0.5rem;overflow:hidden;";
            document.body.appendChild(mount);
            const dark = EditorView.theme({
              ".cm-content": { backgroundColor: "#11161a", color: "#e9eee9" },
              ".cm-gutters": { backgroundColor: "#11161a", color: "#68716b" }
            }, { dark: true });
            window.__vimGuardView = new EditorView({
              doc: "abcdef",
              extensions: [vim(), dark],
              parent: mount
            });
            // Scope sits on the editor root, exactly where the vim theme
            // class sits upstream: same specificity shapes, injected last.
            mount.querySelector(".cm-editor").classList.add("dl-red-probe");
            const replay = document.createElement("style");
            replay.id = "dl-red-probe";
            replay.textContent = ".dl-red-probe .cm-fat-cursor { position: absolute; background: #ff9696; border: none; white-space: pre; }" +
              ".dl-red-probe:not(.cm-focused) .cm-fat-cursor { background: none; outline: solid 1px #ff9696; }";
            document.head.appendChild(replay);
            done("mounted");
          } catch (error) { done("error: " + (error && error.message)); }
        })();
      })(arguments[arguments.length - 1]);
    JAVASCRIPT
    assert_equal "mounted", mount_result
    assert_selector "#vim-guard-probe .cm-fat-cursor", wait: 10

    # Unfocused first: the hollow `[]` outline state.
    blurred = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const fat = document.querySelector("#vim-guard-probe .cm-fat-cursor");
        const style = getComputedStyle(fat);
        return { background: style.backgroundColor, outline: style.outlineColor };
      })()
    JAVASCRIPT
    assert_equal "rgb(159, 197, 169)", blurred["outline"], "unfocused [] outline must be Elef green, got #{blurred.inspect}"
    refute_equal "rgb(255, 150, 150)", blurred["outline"], "upstream vim red leaked into the unfocused block"
    page.save_screenshot("../../assets/pr-shots/vim-normal-cursor/normal-block-unfocused.png")
    save_probe_closeup("../../assets/pr-shots/vim-normal-cursor/normal-block-unfocused-closeup.png")

    # Focused: the solid block state.
    page.execute_script("window.__vimGuardView.focus()")
    assert_selector "#vim-guard-probe .cm-editor.cm-focused", wait: 10
    focused = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const fat = document.querySelector("#vim-guard-probe .cm-fat-cursor");
        return getComputedStyle(fat).backgroundColor;
      })()
    JAVASCRIPT
    assert_equal "rgb(159, 197, 169)", focused, "focused block must be Elef green"
    refute_equal "rgb(255, 150, 150)", focused, "upstream vim red leaked into the focused block"
    page.save_screenshot("../../assets/pr-shots/vim-normal-cursor/normal-block-focused.png")
    save_probe_closeup("../../assets/pr-shots/vim-normal-cursor/normal-block-focused-closeup.png")
  ensure
    page.execute_script("localStorage.removeItem('elef.editor.vim.enabled')")
  end

  private

  # Clipped 2x capture of the guard probe for PR evidence.
  def save_probe_closeup(path)
    clip = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const rect = document.querySelector("#vim-guard-probe").getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 };
      })()
    JAVASCRIPT
    shot = page.driver.browser.execute_cdp("Page.captureScreenshot", format: "png", clip: clip)
    File.binwrite(File.expand_path(path, Dir.pwd), Base64.decode64(shot["data"]))
  end
end
